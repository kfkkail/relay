-- Agent jobs may mutate external systems, so an abandoned job must fail safely
-- instead of being automatically replayed. The owner can then use the existing
-- retry flow after reviewing any partial work.
alter table public.runs add column agent_heartbeat_at timestamptz;

create index runs_stale_agent_idx
  on public.runs(user_id, agent_heartbeat_at)
  where job_kind = 'agent' and status = 'working';

create function public.expire_stale_agent_runs_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired record;
  expired_count integer := 0;
  message constant text := 'Worker heartbeat expired. Review any partial work, then try again.';
begin
  if p_user_id is null then return 0; end if;

  for expired in
    select r.id, r.task_id, r.user_id, r.attempt
    from public.runs r
    where r.user_id = p_user_id
      and r.job_kind = 'agent'
      and r.status = 'working'
      and coalesce(r.agent_heartbeat_at, r.started_at)
        < now() - interval '5 minutes'
    for update skip locked
  loop
    update public.runs
    set status = 'failed', error = message, finished_at = now()
    where id = expired.id and status = 'working';

    if found then
      update public.tasks
      set status = 'waiting'
      where id = expired.task_id
        and not exists (
          select 1 from public.runs active
          where active.task_id = expired.task_id
            and active.status in ('queued', 'working')
        );

      insert into public.events(task_id, run_id, user_id, type, payload)
      values (
        expired.task_id,
        expired.id,
        expired.user_id,
        'run.failed',
        jsonb_build_object(
          'attempt', expired.attempt,
          'error', message,
          'reason', 'heartbeat_expired'
        )
      );
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end;
$$;

revoke all on function public.expire_stale_agent_runs_for_user(uuid)
  from public, anon, authenticated;

create function public.expire_stale_agent_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in required'; end if;
  return public.expire_stale_agent_runs_for_user(uid);
end;
$$;

revoke all on function public.expire_stale_agent_runs()
  from public, anon;
grant execute on function public.expire_stale_agent_runs() to authenticated;

create function public.expire_all_stale_agent_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  expired_count integer := 0;
begin
  for uid in
    select distinct user_id
    from public.runs
    where job_kind = 'agent'
      and status = 'working'
      and coalesce(agent_heartbeat_at, started_at)
        < now() - interval '5 minutes'
  loop
    expired_count := expired_count
      + public.expire_stale_agent_runs_for_user(uid);
  end loop;
  return expired_count;
end;
$$;

revoke all on function public.expire_all_stale_agent_runs()
  from public, anon, authenticated, service_role;
select cron.schedule(
  'relay-agent-run-expiry',
  '* * * * *',
  'select public.expire_all_stale_agent_runs()'
);

-- Preserve the current claim contract while adding stale-run cleanup and the
-- initial heartbeat. A restarted worker releases abandoned work for owner review
-- before it claims anything new.
create or replace function public.claim_next_run(p_worker_id uuid)
returns table(
  run_id uuid,
  task_id uuid,
  title text,
  instructions text,
  deliverable text,
  feedback text,
  attempt integer,
  attachments jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_run public.runs%rowtype;
  uid uuid;
begin
  select user_id into uid
  from public.workers
  where id = p_worker_id and revoked_at is null;
  if uid is null then raise exception 'worker unavailable'; end if;

  perform public.expire_stale_agent_runs_for_user(uid);

  select r.* into selected_run
  from public.runs r
  where r.user_id = uid
    and r.status = 'queued'
    and r.job_kind = 'agent'
  order by r.queued_at
  for update skip locked
  limit 1;
  if selected_run.id is null then return; end if;

  update public.runs
  set status = 'working',
      worker_id = p_worker_id,
      started_at = now(),
      agent_heartbeat_at = now()
  where id = selected_run.id;
  update public.tasks set status = 'working' where id = selected_run.task_id;
  insert into public.events(task_id, run_id, user_id, type, payload)
  values (
    selected_run.task_id,
    selected_run.id,
    selected_run.user_id,
    'run.claimed',
    jsonb_build_object('workerId', p_worker_id)
  );

  return query
  select
    selected_run.id,
    t.id,
    t.title,
    t.instructions,
    selected_run.deliverable,
    selected_run.feedback,
    selected_run.attempt,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.attachment_id,
        'file_name', ra.file_name,
        'mime_type', ra.mime_type,
        'byte_size', ra.byte_size,
        'width', ra.width,
        'height', ra.height
      ))
      from public.run_attachments ra
      where ra.run_id = selected_run.id
    ), '[]'::jsonb)
  from public.tasks t
  where t.id = selected_run.task_id;
end;
$$;


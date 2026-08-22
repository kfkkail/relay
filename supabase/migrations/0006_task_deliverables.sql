alter table public.tasks
  add column deliverable text not null default 'implementation_pr'
  check (deliverable in ('implementation_pr', 'proposal', 'investigation'));

alter table public.runs
  add column deliverable text not null default 'implementation_pr'
  check (deliverable in ('implementation_pr', 'proposal', 'investigation'));

drop function if exists public.claim_next_run(uuid);
create function public.claim_next_run(p_worker_id uuid)
returns table (
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
set search_path = public
as $$
declare
  selected_run public.runs%rowtype;
begin
  if not exists (select 1 from public.workers where id = p_worker_id and revoked_at is null) then
    raise exception 'worker unavailable';
  end if;

  select r.* into selected_run
  from public.runs r
  join public.workers w on w.user_id = r.user_id
  where r.status = 'queued' and w.id = p_worker_id
  order by r.queued_at asc
  for update of r skip locked
  limit 1;

  if selected_run.id is null then return; end if;
  update public.runs set status = 'working', worker_id = p_worker_id, started_at = now() where id = selected_run.id;
  update public.tasks set status = 'working' where id = selected_run.task_id;
  insert into public.events(task_id, run_id, user_id, type, payload)
  values (selected_run.task_id, selected_run.id, selected_run.user_id, 'run.claimed', jsonb_build_object('workerId', p_worker_id));

  return query
  select selected_run.id, t.id, t.title, t.instructions, selected_run.deliverable,
    selected_run.feedback, selected_run.attempt,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ra.attachment_id,
        'file_name', ra.file_name,
        'mime_type', ra.mime_type,
        'byte_size', ra.byte_size,
        'width', ra.width,
        'height', ra.height
      )) from public.run_attachments ra where ra.run_id = selected_run.id
    ), '[]'::jsonb)
  from public.tasks t where t.id = selected_run.task_id;
end;
$$;

revoke all on function public.claim_next_run(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_run(uuid) to service_role;

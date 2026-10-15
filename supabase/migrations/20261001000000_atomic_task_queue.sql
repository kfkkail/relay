-- Publish the run and its image snapshot together so workers cannot claim
-- a partially prepared task. Keep the legacy inbox value for upload staging.
create or replace function public.queue_task(p_task_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  task public.tasks%rowtype;
  new_run_id uuid;
  next_attempt integer;
begin
  select * into task from public.tasks
  where id = p_task_id and user_id = auth.uid() for update;
  if task.id is null then raise exception 'Task not found'; end if;
  if exists (select 1 from public.runs where task_id = task.id and status in ('queued', 'working')) then
    raise exception 'This task already has an active run';
  end if;
  if exists (select 1 from public.task_attachments where task_id = task.id and finalized_at is null) then
    raise exception 'Finish uploading the image before queuing this task';
  end if;
  select coalesce(max(attempt), 0) + 1 into next_attempt from public.runs where task_id = task.id;
  insert into public.runs(task_id, user_id, attempt, deliverable)
  values (task.id, task.user_id, next_attempt, task.deliverable)
  returning id into new_run_id;
  perform public.snapshot_run_attachments(new_run_id);
  update public.tasks set status = 'ready' where id = task.id;
  insert into public.events(task_id, run_id, user_id, type, payload)
  values (task.id, new_run_id, task.user_id, 'run.queued', jsonb_build_object('attempt', next_attempt));
  return new_run_id;
end;
$$;
revoke all on function public.queue_task(uuid) from public, anon;
grant execute on function public.queue_task(uuid) to authenticated;

-- The app issues short-lived anon JWTs with a topic claim after worker authentication.
create policy "relay workers can receive their owner's wakeups"
  on realtime.messages for select to anon
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and topic like 'relay-worker-wakeup:%'
    and (select realtime.topic()) = (select auth.jwt() ->> 'relay_worker_wakeup_topic')
  );

create function public.broadcast_chat_worker_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.tasks
    where id = new.task_id and conversation_id is not null
  ) then
    -- Realtime delivers the broadcast after the transaction commits.
    perform realtime.send(
      '{}'::jsonb, 'queued', 'relay-worker-wakeup:' || new.user_id::text, true
    );
  end if;
  return new;
exception when others then
  raise warning 'Could not broadcast worker wake-up (SQLSTATE %)', sqlstate;
  return new;
end;
$$;

revoke all on function public.broadcast_chat_worker_wakeup() from public, anon, authenticated;

create trigger broadcast_chat_worker_wakeup
after insert on public.runs
for each row when (new.status = 'queued' and new.job_kind = 'agent')
execute function public.broadcast_chat_worker_wakeup();

-- Conversations use the existing durable worker queue; task rows are internal turns.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id)
);
alter table public.conversations enable row level security;
create policy "users own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.tasks add column conversation_id uuid;
alter table public.tasks add column chat_message text;
alter table public.tasks add constraint tasks_conversation_owner_fk
  foreign key (conversation_id, user_id) references public.conversations(id, user_id) on delete cascade;
alter table public.tasks add constraint tasks_chat_message_check check (
  (conversation_id is null and chat_message is null) or
  (conversation_id is not null and chat_message is not null and char_length(chat_message) between 1 and 4000 and deliverable = 'investigation')
);
create index tasks_conversation_created_idx on public.tasks(conversation_id, created_at);
create index conversations_user_updated_idx on public.conversations(user_id, updated_at desc);

create function public.send_chat_message(p_conversation_id uuid, p_message_id uuid, p_message text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  conversation public.conversations%rowtype;
  existing public.tasks%rowtype;
  history jsonb;
  context jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_conversation_id is null or p_message_id is null or p_message is null or char_length(trim(p_message)) not between 1 and 4000 then
    raise exception 'Message must contain 1 to 4000 characters';
  end if;
  insert into public.conversations(id,user_id,title)
    values(p_conversation_id,auth.uid(),left(trim(p_message),80)) on conflict(id) do nothing;
  select * into conversation from public.conversations
    where id=p_conversation_id and user_id=auth.uid() for update;
  if conversation.id is null then raise exception 'Conversation not found'; end if;
  select * into existing from public.tasks where id=p_message_id;
  if existing.id is not null then
    if existing.conversation_id=p_conversation_id and existing.chat_message=trim(p_message) then return existing.id; end if;
    raise exception 'Message ID already used';
  end if;
  if exists(select 1 from public.tasks t join public.runs r on r.task_id=t.id
    where t.conversation_id=p_conversation_id and r.status in ('queued','working')) then
    raise exception 'Wait for the current reply before sending another message';
  end if;
  select coalesce(jsonb_agg(turn order by created_at), '[]'::jsonb) into history from (
    select t.created_at, jsonb_build_object('user',t.chat_message,'assistant',left(r.result_markdown,4000),'status',r.status) as turn
    from public.tasks t left join lateral (
      select result_markdown,status from public.runs where task_id=t.id order by attempt desc limit 1
    ) r on true where t.conversation_id=p_conversation_id order by t.created_at desc limit 12
  ) recent;
  select jsonb_build_object(
    'capturedAt',now(),
    'recentTasks', (select coalesce(jsonb_agg(context_task), '[]'::jsonb) from (
      select id,title,status,left(accepted_result,1000) as accepted_result from public.tasks
      where user_id=auth.uid() and conversation_id is null order by updated_at desc limit 10
    ) context_task),
    'openActions', (select coalesce(jsonb_agg(context_action), '[]'::jsonb) from (
      select id,title,status,due_at from public.owner_actions
      where user_id=auth.uid() and status <> 'done' order by due_at nulls last,updated_at desc limit 20
    ) context_action)
  ) into context;
  insert into public.tasks(id,user_id,title,instructions,deliverable,conversation_id,chat_message)
    values(p_message_id,auth.uid(),left(trim(p_message),80),
      'Conversation history (latest 12 turns; replies limited to 4000 characters; snapshot may be truncated at 60000 characters):' || E'\n' || left(history::text,60000) ||
      E'\nBounded Relay database snapshot (10 recent tasks, 20 open actions; not the full database; snapshot may be truncated at 16000 characters):\n' || left(context::text,16000) ||
      E'\nCurrent message:\n' || trim(p_message),
      'investigation',p_conversation_id,trim(p_message));
  perform public.queue_task(p_message_id);
  update public.conversations set updated_at=now() where id=p_conversation_id;
  return p_message_id;
end;
$$;
revoke all on function public.send_chat_message(uuid,uuid,text) from public,anon;
grant execute on function public.send_chat_message(uuid,uuid,text) to authenticated;

-- Include chat metadata in the atomic claim, avoiding a second fallible read.
create function public.claim_next_run_with_chat(p_worker_id uuid, p_include_chat boolean default false)
returns table (
  run_id uuid,
  task_id uuid,
  title text,
  instructions text,
  deliverable text,
  feedback text,
  attempt integer,
  attachments jsonb,
  conversation_id uuid
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
  join public.tasks queued_task on queued_task.id = r.task_id
  where r.status = 'queued' and w.id = p_worker_id
    and (p_include_chat or queued_task.conversation_id is null)
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
    ), '[]'::jsonb), t.conversation_id
  from public.tasks t where t.id = selected_run.task_id;
end;
$$;

revoke all on function public.claim_next_run_with_chat(uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_next_run_with_chat(uuid,boolean) to service_role;

-- Keep the legacy RPC signature and exclude conversations during rollout.
create or replace function public.claim_next_run(p_worker_id uuid)
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
  join public.tasks queued_task on queued_task.id = r.task_id
  where r.status = 'queued' and w.id = p_worker_id and queued_task.conversation_id is null
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

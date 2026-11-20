create function public.send_chat_message(p_conversation_id uuid, p_message_id uuid, p_message text, p_image jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  conversation public.conversations%rowtype;
  existing public.tasks%rowtype;
  image_path text;
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
    select storage_path into image_path from public.task_attachments
      where task_id=existing.id and finalized_at is not null;
    if existing.conversation_id=p_conversation_id and existing.chat_message=trim(p_message)
      and (image_path is null) = (p_image is null) then
      return jsonb_build_object('messageId',existing.id,'storagePath',image_path);
    end if;
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
  if p_image is not null then
    image_path := auth.uid() || '/' || p_message_id || '/' || ((p_image->>'objectId')::uuid)::text;
    insert into public.task_attachments (
      id, task_id, user_id, storage_path, file_name, mime_type, byte_size, width, height, finalized_at
    ) values (
      p_message_id, p_message_id, auth.uid(), image_path, p_image->>'fileName',
      p_image->>'mimeType', (p_image->>'byteSize')::bigint,
      (p_image->>'width')::int, (p_image->>'height')::int, now()
    );
  end if;
  perform public.queue_task(p_message_id);
  update public.conversations set updated_at=now() where id=p_conversation_id;
  return jsonb_build_object('messageId',p_message_id,'storagePath',image_path);
end;
$$;
revoke all on function public.send_chat_message(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.send_chat_message(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.send_chat_message(p_conversation_id uuid, p_message_id uuid, p_message text)
returns uuid language sql security invoker set search_path = public as $$
  select (public.send_chat_message(p_conversation_id, p_message_id, p_message, null)->>'messageId')::uuid;
$$;

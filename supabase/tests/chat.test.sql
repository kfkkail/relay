begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000091'),('00000000-0000-4000-8000-000000000092');
select ok(not has_function_privilege('anon','public.send_chat_message(uuid,uuid,text)','EXECUTE'),'Anonymous chat is denied');
select ok(has_table_privilege('authenticated','public.conversations','SELECT'),'Authenticated users can read their own conversations');
select ok(has_table_privilege('authenticated','public.conversations','INSERT'),'Authenticated users can create conversations');
select ok(pg_get_functiondef('public.claim_next_run_with_chat(uuid,boolean)'::regprocedure) like '%r.job_kind = ''agent''%','Chat claim excludes vehicle jobs');
select ok(pg_get_functiondef('public.claim_next_run_with_chat(uuid,boolean)'::regprocedure) like '%agent_heartbeat_at = now()%','Chat claim initializes agent heartbeat');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
set local role authenticated;
select public.send_chat_message('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000094','What needs attention?');
select is((select count(*)::integer from public.conversations),1,'Conversation saved');
select is((select count(*)::integer from public.runs where task_id='00000000-0000-4000-8000-000000000094'),1,'Turn atomically queued');
select public.send_chat_message('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000094','What needs attention?');
select is((select count(*)::integer from public.runs where task_id='00000000-0000-4000-8000-000000000094'),1,'Network retry is idempotent');
select throws_ok($$select public.send_chat_message('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000095','Another message')$$,'P0001','Wait for the current reply before sending another message','Pending reply serializes turns');
reset role;
select is((select count(*)::integer from realtime.messages
  where topic='relay-worker-wakeup:00000000-0000-4000-8000-000000000091'
    and extension='broadcast' and event='queued' and private and payload - 'id' = '{}'::jsonb),
  1,'A chat run publishes one private payload-free wake-up even if the send is retried');
select set_config('request.jwt.claims','{}',true);
select set_config('realtime.topic','relay-worker-wakeup:00000000-0000-4000-8000-000000000091',true);
set local role anon;
select is((select count(*)::integer from realtime.messages where event='queued'),0,'The public role alone cannot see wake-ups');
select set_config('request.jwt.claims','{"role":"anon","relay_worker_wakeup_topic":"relay-worker-wakeup:00000000-0000-4000-8000-000000000092"}',true);
select is((select count(*)::integer from realtime.messages where event='queued'),0,'A credential for another owner cannot see the wake-up');
select set_config('request.jwt.claims','{"role":"anon","relay_worker_wakeup_topic":"relay-worker-wakeup:00000000-0000-4000-8000-000000000091"}',true);
select is((select count(*)::integer from realtime.messages where event='queued'),1,'The matching credential can see the wake-up');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Worker completion is privileged; application users must not update runs directly.
reset role;
update public.runs set status='completed',result_markdown='Prepare for tomorrow.' where task_id='00000000-0000-4000-8000-000000000094';
set local role authenticated;
select public.send_chat_message('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000095','Tell me more');
select ok((select instructions like '%Prepare for tomorrow.%' from public.tasks where id='00000000-0000-4000-8000-000000000095'),'Follow-up includes previous answer');
select is((select deliverable from public.tasks where id='00000000-0000-4000-8000-000000000095'),'investigation','Older workers receive an investigation contract');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
select is((select count(*)::integer from public.conversations),0,'Other owners cannot read conversations');
select is((select count(*)::integer from public.tasks where conversation_id is not null),0,'Other owners cannot read turns');
select throws_ok($$select public.send_chat_message('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000096','Intrude')$$,'P0001','Conversation not found','Other owners cannot append turns');
reset role;
select * from finish();
rollback;

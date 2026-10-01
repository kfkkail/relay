begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000081');
insert into public.tasks(id,user_id,title) values
('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081','Queue test');
insert into public.task_attachments(id,task_id,user_id,storage_path,file_name,mime_type,byte_size,width,height) values
('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081','test/queue-image','image.png','image/png',100,10,10);
select ok(not has_function_privilege('anon','public.queue_task(uuid)','EXECUTE'),'Anonymous users cannot queue');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000084',true);
select throws_ok($$select public.queue_task('00000000-0000-4000-8000-000000000082')$$,'P0001','Task not found','Other owners cannot queue');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
set local role authenticated;
select throws_ok($$select public.queue_task('00000000-0000-4000-8000-000000000082')$$,'P0001','Finish uploading the image before queuing this task','Incomplete uploads block queueing');
select is((select count(*)::integer from public.runs where task_id='00000000-0000-4000-8000-000000000082'),0,'Failed queue leaves no run');
update public.task_attachments set finalized_at=now() where id='00000000-0000-4000-8000-000000000083';
select public.queue_task('00000000-0000-4000-8000-000000000082');
select is((select status::text from public.tasks where id='00000000-0000-4000-8000-000000000082'),'ready','Task is queued');
select is((select count(*)::integer from public.run_attachments where attachment_id='00000000-0000-4000-8000-000000000083'),1,'Run includes the image snapshot');
select throws_ok($$select public.queue_task('00000000-0000-4000-8000-000000000082')$$,'P0001','This task already has an active run','Duplicate queue is rejected');
select is((select count(*)::integer from public.events where task_id='00000000-0000-4000-8000-000000000082' and type='run.queued'),1,'Exactly one queue event');
reset role;
select * from finish();
rollback;

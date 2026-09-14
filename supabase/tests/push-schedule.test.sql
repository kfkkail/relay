begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
select is((select count(*)::integer from cron.job where jobname = 'relay-push-delivery' and schedule = '* * * * *'), 1, 'One minute delivery job is installed');
select is(public.invoke_push_delivery(), null::bigint, 'No outbound request without Vault configuration');
select ok(not has_function_privilege('authenticated', 'public.invoke_push_delivery()', 'EXECUTE'), 'Clients cannot invoke the scheduler');
select ok(not has_function_privilege('authenticated', 'public.remove_push_subscription(uuid,uuid)', 'EXECUTE'), 'Clients cannot remove arbitrary device subscriptions');
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'), ('00000000-0000-4000-8000-000000000012');
insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000011','https://web.push.apple.com/device1','test','test'),
('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000011','https://web.push.apple.com/device2','test','test');
select public.remove_push_subscription('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013');
select is((select count(*)::integer from public.push_subscriptions), 2, 'Wrong owner cannot remove a device');
insert into public.tasks(id,user_id,title) values ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000011','test');
insert into public.runs(id,task_id,user_id,attempt) values ('00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000011',1);
update public.runs set status='completed' where id='00000000-0000-4000-8000-000000000016';
select public.remove_push_subscription('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000013');
select is((select count(*)::integer from public.push_subscriptions), 1, 'Sign-out preserves the other device');
select is((select count(*)::integer from public.push_deliveries), 1, 'Only signed-out device pending work is cancelled');
select is((select count(*)::integer from public.push_deliveries where failed_at is not null or subscription_id is null), 0, 'Intentional sign-out creates no failure alarm');
select * from finish();
rollback;

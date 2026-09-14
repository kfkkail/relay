begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.tasks(id, user_id, title) values
('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Push test');
insert into public.push_subscriptions(id, user_id, endpoint, p256dh, auth) values
('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'https://web.push.apple.com/test', 'test', 'test');
insert into public.runs(id, task_id, user_id, attempt) values
('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 1);
update public.runs set status = 'completed' where id = '00000000-0000-4000-8000-000000000004';
update public.runs set status = 'completed' where id = '00000000-0000-4000-8000-000000000004';
select is((select count(*)::integer from public.push_deliveries), 1, 'Repeated completion creates one delivery');
select is((select count(*)::integer from public.claim_push_deliveries()), 1, 'First claim leases delivery');
select is((select count(*)::integer from public.claim_push_deliveries()), 0, 'Leased delivery cannot be claimed again');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT'), 'Clients cannot read subscription credentials');
select ok(not has_function_privilege('authenticated', 'public.claim_push_deliveries()', 'EXECUTE'), 'Clients cannot claim deliveries');
delete from public.push_subscriptions where id = '00000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from public.push_deliveries where subscription_id is null), 1, 'Deleting endpoint preserves delivery evidence');
update public.push_deliveries set available_at = now();
select is((select count(*)::integer from public.claim_push_deliveries()), 0, 'Missing endpoint is not retried');
select is((select count(*)::integer from public.push_deliveries where failed_at is not null and delivered_at is null), 1, 'Missing endpoint is an observable failure');
update public.push_deliveries set finished_at = null, failed_at = null, attempts = 6, available_at = now(), last_status_code = 403;
select count(*) from public.claim_push_deliveries();
select is((select count(*)::integer from public.push_deliveries where failed_at is not null and last_status_code = 403), 1, 'Abandoned final attempt is finalized with redacted failure status');
select * from finish();
rollback;

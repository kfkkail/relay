-- Fresh local databases do not inherit Supabase's hosted default table grants.
-- Keep the authenticated privileges explicit and let the existing owner-only
-- RLS policies continue to decide which rows each user may access.
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert on public.runs to authenticated;
grant select, insert on public.events to authenticated;
grant select, insert, update, delete on public.task_attachments to authenticated;
grant select on public.run_attachments to authenticated;

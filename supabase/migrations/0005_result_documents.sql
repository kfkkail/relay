alter table public.tasks add column accepted_run_id uuid references public.runs(id) on delete set null;

create table public.result_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  display_filename text not null check (char_length(display_filename) between 1 and 200),
  mime_type text not null check (mime_type in ('text/markdown', 'text/plain', 'application/pdf', 'text/csv', 'application/json')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  description text check (description is null or char_length(description) <= 500),
  staged boolean not null default true,
  created_at timestamptz not null default now()
);

create index result_documents_run_idx on public.result_documents(run_id, created_at);
alter table public.result_documents enable row level security;
create policy "users read own result documents" on public.result_documents
  for select using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'result-documents',
  'result-documents',
  false,
  10485760,
  array['text/markdown', 'text/plain', 'application/pdf', 'text/csv', 'application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users read own result document objects" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'result-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.complete_run_with_documents(
  p_run_id uuid,
  p_worker_id uuid,
  p_result_markdown text,
  p_result_artifacts jsonb,
  p_document_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_run public.runs%rowtype;
  expected_count integer := coalesce(array_length(p_document_ids, 1), 0);
begin
  select * into selected_run from public.runs
  where id = p_run_id and worker_id = p_worker_id and status = 'working'
  for update;
  if selected_run.id is null then raise exception 'active run not found'; end if;
  if expected_count > 10 then raise exception 'too many documents'; end if;
  if (select count(*) from result_documents
      where id = any(coalesce(p_document_ids, '{}'::uuid[]))
        and run_id = p_run_id and task_id = selected_run.task_id
        and user_id = selected_run.user_id and staged) <> expected_count then
    raise exception 'document set is invalid';
  end if;

  update result_documents set staged = false
  where id = any(coalesce(p_document_ids, '{}'::uuid[]));
  update runs set status = 'completed', result_markdown = p_result_markdown,
    result_artifacts = p_result_artifacts, finished_at = now()
  where id = selected_run.id;
  update tasks set status = 'waiting' where id = selected_run.task_id;
  insert into events(task_id, run_id, user_id, type, payload)
  values (selected_run.task_id, selected_run.id, selected_run.user_id, 'run.completed',
    jsonb_build_object('attempt', selected_run.attempt, 'artifactCount', jsonb_array_length(p_result_artifacts), 'documentCount', expected_count));
end;
$$;

revoke all on function public.complete_run_with_documents(uuid, uuid, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.complete_run_with_documents(uuid, uuid, text, jsonb, uuid[]) to service_role;

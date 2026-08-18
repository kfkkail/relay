insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tasks add constraint tasks_id_user_id_unique unique (id, user_id);
alter table public.task_attachments add constraint task_attachments_owned_task
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete cascade;

create unique index one_task_attachment
  on public.task_attachments(task_id)
  where finalized_at is not null;

create table public.run_attachments (
  run_id uuid not null references public.runs(id) on delete cascade,
  attachment_id uuid not null references public.task_attachments(id) on delete restrict,
  storage_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  primary key (run_id, attachment_id)
);

alter table public.task_attachments enable row level security;
alter table public.run_attachments enable row level security;

create policy "users own task attachments" on public.task_attachments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users read their run attachments" on public.run_attachments
  for select using (
    exists (
      select 1 from public.runs
      where runs.id = run_attachments.run_id and runs.user_id = auth.uid()
    )
  );

create or replace function public.snapshot_run_attachments(p_run_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.run_attachments (
    run_id, attachment_id, storage_path, file_name, mime_type, byte_size, width, height
  )
  select p_run_id, a.id, a.storage_path, a.file_name, a.mime_type,
    a.byte_size, a.width, a.height
  from public.task_attachments a
  join public.runs r on r.id = p_run_id and r.task_id = a.task_id and r.user_id = a.user_id
    and (r.user_id = auth.uid() or auth.role() = 'service_role')
  where a.finalized_at is not null
  on conflict do nothing;
$$;

revoke all on function public.snapshot_run_attachments(uuid) from public, anon;
grant execute on function public.snapshot_run_attachments(uuid) to authenticated, service_role;

drop function if exists public.claim_next_run(uuid);
create function public.claim_next_run(p_worker_id uuid)
returns table (
  run_id uuid,
  task_id uuid,
  title text,
  instructions text,
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
  if not exists (
    select 1 from public.workers
    where id = p_worker_id and revoked_at is null
  ) then raise exception 'worker unavailable'; end if;

  select r.* into selected_run
  from public.runs r
  join public.workers w on w.user_id = r.user_id
  where r.status = 'queued' and w.id = p_worker_id
  order by r.queued_at asc
  for update of r skip locked limit 1;

  if selected_run.id is null then return; end if;

  update public.runs set status = 'working', worker_id = p_worker_id, started_at = now()
  where id = selected_run.id;
  update public.tasks set status = 'working' where id = selected_run.task_id;
  insert into public.events(task_id, run_id, user_id, type, payload)
  values (selected_run.task_id, selected_run.id, selected_run.user_id, 'run.claimed',
    jsonb_build_object('workerId', p_worker_id));

  return query
  select selected_run.id, t.id, t.title, t.instructions,
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

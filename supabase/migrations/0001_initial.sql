create extension if not exists pgcrypto;

create type public.task_status as enum ('inbox', 'ready', 'working', 'waiting', 'done');
create type public.run_status as enum ('queued', 'working', 'completed', 'failed', 'cancelled');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  status public.task_status not null default 'inbox',
  instructions text not null default '' check (char_length(instructions) <= 100000),
  accepted_result text check (accepted_result is null or char_length(accepted_result) <= 200000),
  parent_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.run_status not null default 'queued',
  attempt integer not null check (attempt > 0),
  worker_id uuid references public.workers(id) on delete set null,
  feedback text check (feedback is null or char_length(feedback) <= 20000),
  result_markdown text check (result_markdown is null or char_length(result_markdown) <= 200000),
  result_artifacts jsonb not null default '[]'::jsonb check (jsonb_typeof(result_artifacts) = 'array'),
  error text check (error is null or char_length(error) <= 20000),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (task_id, attempt)
);

create unique index one_active_run_per_task
  on public.runs(task_id)
  where status in ('queued', 'working');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  run_id uuid references public.runs(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 80),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create index tasks_user_updated_idx on public.tasks(user_id, updated_at desc);
create index runs_task_attempt_idx on public.runs(task_id, attempt desc);
create index events_task_created_idx on public.events(task_id, created_at desc);

create function public.touch_task_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_task_updated_at();

alter table public.tasks enable row level security;
alter table public.runs enable row level security;
alter table public.events enable row level security;
alter table public.workers enable row level security;

create policy "users own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own runs" on public.runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own events" on public.events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own workers" on public.workers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.claim_next_run(p_worker_id uuid)
returns table (
  run_id uuid,
  task_id uuid,
  title text,
  instructions text,
  feedback text,
  attempt integer
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
  ) then
    raise exception 'worker unavailable';
  end if;

  select r.* into selected_run
  from public.runs r
  join public.workers w on w.user_id = r.user_id
  where r.status = 'queued' and w.id = p_worker_id
  order by r.queued_at asc
  for update of r skip locked
  limit 1;

  if selected_run.id is null then return; end if;

  update public.runs
  set status = 'working', worker_id = p_worker_id, started_at = now()
  where id = selected_run.id;

  update public.tasks set status = 'working' where id = selected_run.task_id;

  insert into public.events(task_id, run_id, user_id, type, payload)
  values (selected_run.task_id, selected_run.id, selected_run.user_id, 'run.claimed',
    jsonb_build_object('workerId', p_worker_id));

  return query
  select selected_run.id, t.id, t.title, t.instructions,
    selected_run.feedback, selected_run.attempt
  from public.tasks t where t.id = selected_run.task_id;
end;
$$;

revoke all on function public.claim_next_run(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_run(uuid) to service_role;

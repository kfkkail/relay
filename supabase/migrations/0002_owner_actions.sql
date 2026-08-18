create type public.owner_action_status as enum ('todo', 'in_progress', 'done');

create table public.owner_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  notes text not null default '' check (char_length(notes) <= 20000),
  status public.owner_action_status not null default 'todo',
  due_at timestamptz,
  snoozed_until timestamptz,
  position bigint not null default 0 check (position >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done' and completed_at is not null) or (status <> 'done' and completed_at is null))
);

create table public.owner_action_tasks (
  owner_action_id uuid not null references public.owner_actions(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_action_id, task_id)
);

create index owner_actions_active_order_idx
  on public.owner_actions(user_id, status, snoozed_until, due_at, position);
create index owner_action_tasks_task_idx on public.owner_action_tasks(task_id, owner_action_id);

create function public.touch_owner_action_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_owner_actions_updated_at
before update on public.owner_actions
for each row execute function public.touch_owner_action_updated_at();

create function public.validate_owner_action_task_ownership()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.owner_actions where id = new.owner_action_id and user_id = new.user_id)
    or not exists (select 1 from public.tasks where id = new.task_id and user_id = new.user_id) then
    raise exception 'owner action and task must have the same owner';
  end if;
  return new;
end;
$$;

create trigger validate_owner_action_task_ownership
before insert or update on public.owner_action_tasks
for each row execute function public.validate_owner_action_task_ownership();

alter table public.owner_actions enable row level security;
alter table public.owner_action_tasks enable row level security;

create policy "users own owner actions" on public.owner_actions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own owner action links" on public.owner_action_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

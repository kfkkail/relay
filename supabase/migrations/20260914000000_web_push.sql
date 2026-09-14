-- Push delivery is independent of the laptop worker. No client can read keys
-- or mutate the outbox; authenticated API routes use the service role.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  run_id uuid not null references public.runs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  outcome text not null check (outcome in ('completed', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (subscription_id, run_id, outcome)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
create index push_deliveries_pending on public.push_deliveries(available_at) where finished_at is null;

create function public.enqueue_run_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('completed', 'failed') and old.status is distinct from new.status then
    insert into public.push_deliveries(subscription_id, run_id, task_id, outcome)
      select s.id, new.id, new.task_id, new.status::text
      from public.push_subscriptions s where s.user_id = new.user_id
      on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_run_push() from public, anon, authenticated;
create trigger enqueue_run_push after update of status on public.runs
for each row execute function public.enqueue_run_push();

create function public.claim_push_deliveries()
returns setof public.push_deliveries
language sql security definer set search_path = '' as $$
  update public.push_deliveries set
    attempts = attempts + 1,
    available_at = now() + interval '5 minutes'
  where id in (
    select id from public.push_deliveries
    where finished_at is null and available_at <= now()
      and attempts < 6 and created_at > now() - interval '24 hours'
    order by available_at limit 20 for update skip locked
  ) returning *;
$$;
revoke all on function public.claim_push_deliveries() from public, anon, authenticated;
grant execute on function public.claim_push_deliveries() to service_role;

-- Preserve terminal failure evidence even when expired subscriptions are removed.
alter table public.push_deliveries
  add column delivered_at timestamptz,
  add column failed_at timestamptz,
  add column last_status_code integer check (last_status_code between 0 and 599),
  alter column subscription_id drop not null;
alter table public.push_deliveries drop constraint push_deliveries_subscription_id_fkey;
alter table public.push_deliveries add constraint push_deliveries_subscription_id_fkey
  foreign key (subscription_id) references public.push_subscriptions(id) on delete set null;
-- Old finished records have unknown outcomes; do not label them as successes.
create index push_deliveries_failed on public.push_deliveries(failed_at) where failed_at is not null;

create or replace function public.claim_push_deliveries()
returns setof public.push_deliveries
language plpgsql security definer set search_path = '' as $$
begin
  -- Recover abandoned final attempts and expire old work without silently
  -- dropping it from the claim predicate. An active lease is left alone.
  update public.push_deliveries set finished_at = now(), failed_at = now(),
    last_status_code = coalesce(last_status_code, 0)
  where finished_at is null and available_at <= now()
    and (attempts >= 6 or created_at <= now() - interval '24 hours' or subscription_id is null);

  return query update public.push_deliveries set
    attempts = attempts + 1,
    available_at = now() + interval '5 minutes'
  where id in (
    select id from public.push_deliveries
    where finished_at is null and available_at <= now()
      and attempts < 6 and created_at > now() - interval '24 hours'
      and subscription_id is not null
    order by available_at limit 20 for update skip locked
  ) returning *;
end;
$$;

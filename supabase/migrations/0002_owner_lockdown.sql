-- Store the owner identifier outside the API-exposed public schema. After this
-- migration, insert the owner's immutable numeric GitHub ID with:
-- insert into relay_private.configuration (owner_github_id) values ('<github-id>');
begin;

create schema if not exists relay_private;
revoke all on schema relay_private from public, anon, authenticated;

create table relay_private.configuration (
  singleton boolean primary key default true check (singleton),
  owner_github_id text not null check (owner_github_id ~ '^\d+$')
);

alter table relay_private.configuration enable row level security;
revoke all on table relay_private.configuration from public, anon, authenticated;

create or replace function public.is_relay_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities identity
    cross join relay_private.configuration configuration
    where identity.user_id = auth.uid()
      and identity.provider = 'github'
      and identity.provider_id = configuration.owner_github_id
  );
$$;

revoke all on function public.is_relay_owner() from public;
grant execute on function public.is_relay_owner() to authenticated;

-- Configure this function as Authentication > Hooks > Before User Created after
-- the owner has signed in once. Existing users can still sign in; every attempt
-- to create another auth.users row is rejected.
create or replace function public.deny_new_relay_accounts(event jsonb)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This Relay deployment does not accept new accounts.'
    )
  );
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.deny_new_relay_accounts(jsonb) to supabase_auth_admin;
revoke execute on function public.deny_new_relay_accounts(jsonb) from authenticated, anon, public;

drop policy if exists "users own tasks" on public.tasks;
create policy "owner owns tasks" on public.tasks
  for all
  using (public.is_relay_owner() and auth.uid() = user_id)
  with check (public.is_relay_owner() and auth.uid() = user_id);

drop policy if exists "users own runs" on public.runs;
create policy "owner owns runs" on public.runs
  for all
  using (public.is_relay_owner() and auth.uid() = user_id)
  with check (public.is_relay_owner() and auth.uid() = user_id);

drop policy if exists "users own events" on public.events;
create policy "owner owns events" on public.events
  for all
  using (public.is_relay_owner() and auth.uid() = user_id)
  with check (public.is_relay_owner() and auth.uid() = user_id);

drop policy if exists "users own workers" on public.workers;
create policy "owner owns workers" on public.workers
  for all
  using (public.is_relay_owner() and auth.uid() = user_id)
  with check (public.is_relay_owner() and auth.uid() = user_id);

commit;

-- VIN decoding is evidence, not an owner override or a seller snapshot.
alter table public.vehicles add column if not exists nhtsa jsonb not null default '{}'::jsonb;
comment on column public.vehicles.nhtsa is 'NHTSA vPIC evidence. Missing fields are unknown; capacity is not a named battery pack.';

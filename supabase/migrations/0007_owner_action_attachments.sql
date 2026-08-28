create table public.owner_action_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_action_id uuid not null,
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

alter table public.owner_actions
  add constraint owner_actions_id_user_id_unique unique (id, user_id);
alter table public.owner_action_attachments
  add constraint owner_action_attachments_owned_action
  foreign key (owner_action_id, user_id)
  references public.owner_actions(id, user_id) on delete cascade;

create index owner_action_attachments_action_idx
  on public.owner_action_attachments(owner_action_id, created_at);

alter table public.owner_action_attachments enable row level security;
create policy "users own owner action attachments"
  on public.owner_action_attachments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

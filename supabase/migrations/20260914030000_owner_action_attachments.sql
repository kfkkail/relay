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
  abandoned_at timestamptz,
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
revoke insert, update on public.owner_action_attachments from anon, authenticated;

create function public.reserve_owner_action_attachment(
  p_user_id uuid,
  p_action_id uuid,
  p_attachment_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  abandoned jsonb;
begin
  perform 1
  from public.owner_actions
  where id = p_action_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'abandoned', '[]'::jsonb);
  end if;

  update public.owner_action_attachments
  set abandoned_at = now()
  where owner_action_id = p_action_id
    and finalized_at is null
    and abandoned_at is null
    and created_at < now() - interval '1 hour';

  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'storagePath', storage_path)),
    '[]'::jsonb
  ) into abandoned
  from public.owner_action_attachments
  where owner_action_id = p_action_id and abandoned_at is not null;

  if (
    select count(*)
    from public.owner_action_attachments
    where owner_action_id = p_action_id and abandoned_at is null
  ) >= 10 then
    return jsonb_build_object('status', 'limit_reached', 'abandoned', abandoned);
  end if;

  insert into public.owner_action_attachments (
    id, owner_action_id, user_id, storage_path, file_name, mime_type, byte_size
  ) values (
    p_attachment_id, p_action_id, p_user_id, p_storage_path,
    p_file_name, p_mime_type, p_byte_size
  );

  return jsonb_build_object('status', 'created', 'abandoned', abandoned);
end;
$$;

revoke all on function public.reserve_owner_action_attachment(
  uuid, uuid, uuid, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.reserve_owner_action_attachment(
  uuid, uuid, uuid, text, text, text, bigint
) to service_role;

notify pgrst, 'reload schema';

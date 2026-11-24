alter table public.owner_actions add column note_images jsonb not null default '{}'::jsonb;

-- Store the notes and their images in one write. Removing a reference also
-- removes its image bytes, and deleting the action removes the whole payload.
create function public.retain_owner_action_note_images()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  available_images jsonb := new.note_images;
begin
  if tg_op = 'UPDATE' then
    available_images := old.note_images || new.note_images;
  end if;

  select coalesce(jsonb_object_agg(image.key, image.value), '{}'::jsonb)
  into new.note_images
  from jsonb_each(available_images) image
  where strpos(new.notes, '](relay-note-image/' || image.key || ')') > 0;

  if octet_length(new.note_images::text) > 16777216 then
    raise sqlstate 'PT400' using message = 'Action images must total 12 MB or less. Remove an image and try again.';
  end if;

  return new;
end;
$$;

create trigger retain_owner_action_note_images
before insert or update of notes, note_images on public.owner_actions
for each row execute function public.retain_owner_action_note_images();

create function public.read_owner_action_note_image(p_action_id uuid, p_image_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select action.note_images -> p_image_id::text
  from public.owner_actions action
  where action.id = p_action_id and action.user_id = auth.uid();
$$;

revoke all on function public.read_owner_action_note_image(uuid, uuid) from public, anon;
grant execute on function public.read_owner_action_note_image(uuid, uuid) to authenticated;

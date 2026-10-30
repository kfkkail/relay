-- Full galleries are enrichment, not part of the daily source snapshot. Keep
-- them in dedicated columns so inventory upserts and observations remain
-- accurate while previously fetched photos survive future searches.
alter table public.vehicle_listings
 add column photo_gallery jsonb not null default '[]'::jsonb
  check(jsonb_typeof(photo_gallery)='array' and jsonb_array_length(photo_gallery)<=50),
 add column gallery_fetched_at timestamptz;

-- Preserve galleries fetched before these dedicated columns existed.
update public.vehicle_listings
set photo_gallery=data->'photos',gallery_fetched_at=now()
where source='auto.dev'
 and jsonb_typeof(data->'photos')='array'
 and jsonb_array_length(data->'photos')>1;

create or replace function public.complete_vehicle_photos(p_run uuid,p_worker uuid,p_lease uuid,p_photos jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null or r.job_payload->>'photo_vin' is null then raise exception 'Photo run not found'; end if;
 if r.status='completed' then return; end if;
 if r.status<>'working' or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>50 then raise exception 'Invalid photo result'; end if;
 update public.vehicle_listings set photo_gallery=p_photos,gallery_fetched_at=now() where user_id=r.user_id and source='auto.dev' and data->>'vin'=r.job_payload->>'photo_vin';
 update public.runs set status='completed',finished_at=now(),result_markdown='[Vehicle photos ready](/vehicles)' where id=p_run;
 update public.tasks set status='done' where id=r.task_id;
end $$;

create function public.request_vehicle_photo_batch(p_vehicles uuid[],p_profile uuid) returns uuid[]
language plpgsql security invoker set search_path='' as $$
declare vehicle uuid; task_ids uuid[]:=array[]::uuid[];
begin
 if coalesce(cardinality(p_vehicles),0) not between 1 and 25
  or (select count(distinct value) from unnest(p_vehicles) as ids(value))<>cardinality(p_vehicles)
 then raise exception 'Choose between 1 and 25 distinct vehicles'; end if;
 foreach vehicle in array p_vehicles loop
  task_ids:=array_append(task_ids,public.request_vehicle_photos(vehicle,p_profile));
 end loop;
 return task_ids;
end $$;
revoke all on function public.request_vehicle_photo_batch(uuid[],uuid) from public,anon;
grant execute on function public.request_vehicle_photo_batch(uuid[],uuid) to authenticated;

-- Seller-scoped verification still rechecks listing identity transactionally,
-- but an interior choice may now come from the durable gallery column.
create or replace function public.verify_vehicle(p_id uuid,p_overrides jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing jsonb; merged jsonb; scoped jsonb; patch record; current_listing jsonb; current_gallery jsonb; field text;
begin
 if p_overrides is null or jsonb_typeof(p_overrides)<>'object' or octet_length(p_overrides::text)>20000 then raise exception 'Invalid verification'; end if;
 select overrides into existing from public.vehicles where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Vehicle not found'; end if;
 if exists(select 1 from jsonb_object_keys(p_overrides) k where k not in ('attributes','title_status','history_available','history_flags','listing_verifications')) then raise exception 'Invalid verification fields'; end if;
 if p_overrides ? 'listing_verifications' and jsonb_typeof(p_overrides->'listing_verifications')<>'object' then raise exception 'Invalid listing verification'; end if;
 scoped:=coalesce(existing->'listing_verifications','{}');
 for patch in select * from jsonb_each(coalesce(p_overrides->'listing_verifications','{}')) loop
  select data,photo_gallery into current_listing,current_gallery from public.vehicle_listings where vehicle_id=p_id and user_id=auth.uid() and source=patch.value->>'source' and source_listing_id=patch.value->>'source_listing_id' for update;
  if not found or patch.key is distinct from (patch.value->>'source')||':'||(patch.value->>'source_listing_id') then raise exception 'Listing not found'; end if;
  foreach field in array array['source','source_listing_id','seller','seller_id','url'] loop
   if current_listing->field is distinct from patch.value->field then raise exception 'Listing changed; refresh before verifying'; end if;
  end loop;
  if patch.value ? 'interior_photo' and not exists(
   select 1 from jsonb_array_elements(coalesce(current_gallery,'[]')||coalesce(current_listing->'photos','[]')) p where p->>'url'=patch.value->>'interior_photo'
  ) then raise exception 'Photo changed; reload the gallery'; end if;
  if exists(select 1 from unnest(array['source','source_listing_id','seller','seller_id','url']) f where scoped->patch.key->f is distinct from patch.value->f) then scoped:=scoped-patch.key; end if;
  scoped:=jsonb_set(scoped,array[patch.key],coalesce(scoped->patch.key,'{}')||patch.value);
 end loop;
 merged:=(existing-array['price','shipping','mandatory_fees','delivery','photos','listing_verifications'])||(p_overrides-'listing_verifications')||jsonb_build_object('listing_verifications',scoped);
 if octet_length(merged::text)>200000 then raise exception 'Too many listing verifications'; end if;
 update public.vehicles set overrides=merged where id=p_id;
end $$;

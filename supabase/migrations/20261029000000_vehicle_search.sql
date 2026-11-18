-- Vehicles are durable owner data; Relay runs only orchestrate collection.
alter table public.tasks add column job_kind text not null default 'agent' check(job_kind in ('agent','vehicle_search'));
alter table public.tasks add column job_payload jsonb not null default '{}';
alter table public.runs add column job_kind text not null default 'agent' check(job_kind in ('agent','vehicle_search'));
alter table public.runs add column job_payload jsonb not null default '{}';
alter table public.runs add column vehicle_heartbeat_at timestamptz;
alter table public.runs add column vehicle_lease uuid;
alter table public.task_schedules add column job_kind text not null default 'agent' check(job_kind in ('agent','vehicle_search'));
alter table public.task_schedules add column job_payload jsonb not null default '{}';

create table public.vehicle_search_profiles (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null default 'Vehicle search', version integer not null default 1,
 config jsonb not null check(jsonb_typeof(config)='object'),
 schedule_id uuid references public.task_schedules(id), created_at timestamptz not null default now(),
 unique(id,user_id), unique(user_id,name)
);
create table public.vehicle_profile_versions (
 profile_id uuid not null, user_id uuid not null, version integer not null,
 config jsonb not null, created_at timestamptz not null default now(), primary key(profile_id,version),
 foreign key(profile_id,user_id) references public.vehicle_search_profiles(id,user_id) on delete cascade
);
create table public.vehicles (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 vin text check(vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), identity_key text not null,
 decision text not null default 'unreviewed' check(decision in ('unreviewed','passed','watch','shortlist')),
 decision_revision integer not null default 0, decision_at timestamptz,
 overrides jsonb not null default '{}', first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 unique(id,user_id), unique(user_id,vin), unique(user_id,identity_key)
);
create table public.vehicle_listings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 vehicle_id uuid not null, source text not null check(source in ('auto.dev','manual')),
 source_listing_id text not null, data jsonb not null check(jsonb_typeof(data)='object'),
 eligibility text not null check(eligibility in ('eligible','ineligible','needs_verification')),
 availability text not null default 'available' check(availability in ('available','unavailable')),
 consecutive_absences integer not null default 0, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 foreign key(vehicle_id,user_id) references public.vehicles(id,user_id) on delete cascade,
 unique(user_id,source,source_listing_id)
);
create index vehicle_listings_vehicle_idx on public.vehicle_listings(vehicle_id);
create table public.vehicle_listing_observations (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
 listing_id uuid not null references public.vehicle_listings(id) on delete cascade,
 data jsonb not null, observed_at timestamptz not null default now()
);
create table public.vehicle_search_runs (
 run_id uuid primary key references public.runs(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 profile_id uuid not null, profile_version integer not null,
 status text not null check(status in ('success','partial','blocked','failed')),
 health jsonb not null, summary jsonb not null default '{}', finished_at timestamptz not null default now(),
 foreign key(profile_id,profile_version) references public.vehicle_profile_versions(profile_id,version)
);
-- Staging is not visible in the review UI. Finalization ingests all batches in
-- one transaction and deletes staging; a lost HTTP response is safe to retry.
create table public.vehicle_ingestion_batches (
 run_id uuid not null references public.runs(id) on delete cascade, batch_number integer not null check(batch_number between 0 and 99),
 payload jsonb not null check(jsonb_typeof(payload)='array' and jsonb_array_length(payload)<=100), primary key(run_id,batch_number)
);
do $$ declare tab text; begin
 foreach tab in array array['vehicle_search_profiles','vehicle_profile_versions','vehicles','vehicle_listings','vehicle_listing_observations','vehicle_search_runs'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('create policy "owner reads vehicles" on public.%I for select to authenticated using(user_id=auth.uid())',tab);
  execute format('revoke all on public.%I from anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
 end loop;
end $$;
alter table public.vehicle_ingestion_batches enable row level security;
revoke all on public.vehicle_ingestion_batches from anon,authenticated;
grant all on public.vehicle_search_profiles,public.vehicle_profile_versions,public.vehicles,public.vehicle_listings,public.vehicle_listing_observations,public.vehicle_search_runs,public.vehicle_ingestion_batches to service_role;
grant usage,select on sequence public.vehicle_listing_observations_id_seq to service_role;

create function public.save_vehicle_profile(p_id uuid,p_config jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); pid uuid; sid uuid; rev integer; old_config jsonb;
begin
 if uid is null then raise exception 'Sign in required'; end if;
 if jsonb_typeof(p_config)<>'object' or length(coalesce(p_config->>'make','')) not between 1 and 80 or length(coalesce(p_config->>'model','')) not between 1 and 80 or coalesce(p_config->>'origin_zip','') !~ '^\d{5}$' or coalesce((p_config->>'cost_ceiling')::numeric,0)<=0 or jsonb_typeof(p_config->'allowed_batteries')<>'array' then raise exception 'Invalid profile'; end if;
 if p_id is null then
  insert into public.vehicle_search_profiles(user_id,name,config) values(uid,'Vehicle search',p_config) returning id,version into pid,rev;
  insert into public.task_schedules(user_id,title,instructions,deliverable,timezone,weekdays,interval_minutes,start_minute,end_minute,enabled,next_due_at,job_kind,job_payload)
   values(uid,'Vehicle search','Collect the configured vehicle inventory.','investigation','America/Indiana/Indianapolis',array[0,1,2,3,4,5,6],1440,420,421,false,public.next_schedule_slot('America/Indiana/Indianapolis',array[0,1,2,3,4,5,6],1440,420,421,now()),'vehicle_search',jsonb_build_object('profile_id',pid,'profile_version',rev)) returning id into sid;
  update public.vehicle_search_profiles set schedule_id=sid where id=pid;
 else
  select id,schedule_id,version+1,config into pid,sid,rev,old_config from public.vehicle_search_profiles where id=p_id and user_id=uid for update;
  if pid is null then raise exception 'Profile not found'; end if;
  update public.vehicle_search_profiles set version=rev,config=p_config where id=pid;
  update public.task_schedules set job_payload=jsonb_build_object('profile_id',pid,'profile_version',rev),
   enabled=enabled and lower(old_config->>'make')=lower(p_config->>'make') and lower(old_config->>'model')=lower(p_config->>'model') and old_config->>'origin_zip'=p_config->>'origin_zip'
   where id=sid and user_id=uid;
 end if;
 insert into public.vehicle_profile_versions(profile_id,user_id,version,config) values(pid,uid,rev,p_config);
 return pid;
end $$;
revoke all on function public.save_vehicle_profile(uuid,jsonb) from public,anon;
grant execute on function public.save_vehicle_profile(uuid,jsonb) to authenticated;

-- Guard the shared Schedules RPC too, not just the Vehicles screen. A baseline
-- from another collection scope cannot authorize a newly edited search.
create function public.guard_vehicle_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg jsonb;
begin
 if new.job_kind='vehicle_search' and new.enabled then
  select config into cfg from public.vehicle_search_profiles where id=(new.job_payload->>'profile_id')::uuid and user_id=new.user_id and schedule_id=new.id;
  if cfg is null or not exists(
   select 1 from public.vehicle_search_runs s where s.profile_id=(new.job_payload->>'profile_id')::uuid and s.user_id=new.user_id and s.status='success'
   and lower(s.health->'scope'->>'make')=lower(cfg->>'make') and lower(s.health->'scope'->>'model')=lower(cfg->>'model') and s.health->'scope'->>'origin_zip'=cfg->>'origin_zip'
  ) then raise exception 'Complete and review a successful manual baseline for this search scope before enabling daily searches'; end if;
 end if;
 return new;
end $$;
create trigger guard_vehicle_schedule before insert or update on public.task_schedules for each row execute function public.guard_vehicle_schedule();
revoke all on function public.guard_vehicle_schedule() from public,anon,authenticated;

create function public.snapshot_vehicle_job() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='tasks' then
  if new.schedule_id is not null then
   select job_kind,job_payload into new.job_kind,new.job_payload from public.task_schedules where id=new.schedule_id and user_id=new.user_id;
  end if;
 elsif TG_TABLE_NAME='runs' then
  select job_kind,job_payload into new.job_kind,new.job_payload from public.tasks where id=new.task_id and user_id=new.user_id;
 end if;
 if new.job_kind='vehicle_search' and not exists(select 1 from public.vehicle_profile_versions where profile_id=(new.job_payload->>'profile_id')::uuid and version=(new.job_payload->>'profile_version')::integer and user_id=new.user_id) then raise exception 'Vehicle profile revision not found'; end if;
 return new;
end $$;
create trigger snapshot_vehicle_task before insert on public.tasks for each row execute function public.snapshot_vehicle_job();
create trigger snapshot_vehicle_run before insert on public.runs for each row execute function public.snapshot_vehicle_job();
revoke all on function public.snapshot_vehicle_job() from public,anon,authenticated;

-- The legacy RPC remains compatible, but old workers can claim only agent work.
create or replace function public.claim_next_run(p_worker_id uuid)
returns table(run_id uuid,task_id uuid,title text,instructions text,deliverable text,feedback text,attempt integer,attachments jsonb)
language plpgsql security definer set search_path='' as $$
declare selected_run public.runs%rowtype;
begin
 if not exists(select 1 from public.workers where id=p_worker_id and revoked_at is null) then raise exception 'worker unavailable'; end if;
 select r.* into selected_run from public.runs r join public.workers w on w.user_id=r.user_id where r.status='queued' and r.job_kind='agent' and w.id=p_worker_id order by r.queued_at for update of r skip locked limit 1;
 if selected_run.id is null then return; end if;
 update public.runs set status='working',worker_id=p_worker_id,started_at=now() where id=selected_run.id;
 update public.tasks set status='working' where id=selected_run.task_id;
 insert into public.events(task_id,run_id,user_id,type,payload) values(selected_run.task_id,selected_run.id,selected_run.user_id,'run.claimed',jsonb_build_object('workerId',p_worker_id));
 return query select selected_run.id,t.id,t.title,t.instructions,selected_run.deliverable,selected_run.feedback,selected_run.attempt,coalesce((select jsonb_agg(jsonb_build_object('id',ra.attachment_id,'file_name',ra.file_name,'mime_type',ra.mime_type,'byte_size',ra.byte_size,'width',ra.width,'height',ra.height)) from public.run_attachments ra where ra.run_id=selected_run.id),'[]'::jsonb) from public.tasks t where t.id=selected_run.task_id;
end $$;

create function public.claim_vehicle_run(p_worker_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; uid uuid; cfg jsonb;
begin
 select user_id into uid from public.workers where id=p_worker_id and revoked_at is null;
 if uid is null then raise exception 'worker unavailable'; end if;
 -- A vehicle retry is read-only collection. Reset only expired vehicle leases;
 -- generic tasks that might mutate external systems are never retried here.
 for r in select * from public.runs where user_id=uid and job_kind='vehicle_search' and status='working' and coalesce(vehicle_heartbeat_at,started_at)<now()-interval '15 minutes' for update skip locked loop
  delete from public.vehicle_ingestion_batches where run_id=r.id;
  update public.runs set status='queued',worker_id=null,started_at=null where id=r.id;
 end loop;
 select * into r from public.runs where user_id=uid and job_kind='vehicle_search' and status='queued' order by queued_at for update skip locked limit 1;
 if r.id is null then return null; end if;
 select config into cfg from public.vehicle_profile_versions where profile_id=(r.job_payload->>'profile_id')::uuid and version=(r.job_payload->>'profile_version')::integer and user_id=uid;
 if cfg is null then raise exception 'Vehicle profile revision missing'; end if;
 update public.runs set status='working',worker_id=p_worker_id,started_at=now(),vehicle_heartbeat_at=now(),vehicle_lease=gen_random_uuid() where id=r.id returning vehicle_lease into r.vehicle_lease;
 update public.tasks set status='working' where id=r.task_id;
 return jsonb_build_object('run',jsonb_build_object('id',r.id,'attempt',r.attempt,'job_kind','vehicle_search','job_payload',r.job_payload,'lease',r.vehicle_lease),'task',jsonb_build_object('id',r.task_id),'profile',cfg,'attachments','[]'::jsonb);
end $$;

create function public.stage_vehicle_batch(p_run uuid,p_worker uuid,p_lease uuid,p_batch integer,p_listings jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 perform 1 from public.runs r join public.workers w on w.id=r.worker_id and w.user_id=r.user_id and w.revoked_at is null where r.id=p_run and r.worker_id=p_worker and r.vehicle_lease=p_lease and r.job_kind='vehicle_search' and r.status='working' for update of r;
 if not found then raise exception 'Active vehicle run not found'; end if;
 select payload into previous from public.vehicle_ingestion_batches where run_id=p_run and batch_number=p_batch;
 if previous is not null and previous<>p_listings then raise exception 'Batch content changed'; end if;
 insert into public.vehicle_ingestion_batches(run_id,batch_number,payload) values(p_run,p_batch,p_listings) on conflict do nothing;
 update public.runs set vehicle_heartbeat_at=now() where id=p_run;
end $$;

create function public.set_vehicle_decision(p_id uuid,p_decision text,p_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare rev integer;
begin
 update public.vehicles set decision=p_decision,decision_revision=decision_revision+1,decision_at=now() where id=p_id and user_id=auth.uid() and decision_revision=p_revision returning decision_revision into rev;
 if rev is null then raise exception 'Vehicle changed; refresh before deciding'; end if;
 return rev;
end $$;
create function public.verify_vehicle(p_id uuid,p_overrides jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare existing jsonb; merged jsonb; scoped jsonb; patch record; current_listing jsonb; field text;
begin
 if p_overrides is null or jsonb_typeof(p_overrides)<>'object' or octet_length(p_overrides::text)>20000 then raise exception 'Invalid verification'; end if;
 select overrides into existing from public.vehicles where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Vehicle not found'; end if;
 if exists(select 1 from jsonb_object_keys(p_overrides) k where k not in ('attributes','title_status','history_available','history_flags','listing_verifications')) then raise exception 'Invalid verification fields'; end if;
 if p_overrides ? 'listing_verifications' and jsonb_typeof(p_overrides->'listing_verifications')<>'object' then raise exception 'Invalid listing verification'; end if;
 scoped:=coalesce(existing->'listing_verifications','{}');
 for patch in select * from jsonb_each(coalesce(p_overrides->'listing_verifications','{}')) loop
  select data into current_listing from public.vehicle_listings where vehicle_id=p_id and user_id=auth.uid() and source=patch.value->>'source' and source_listing_id=patch.value->>'source_listing_id' for update;
  if not found or patch.key is distinct from (patch.value->>'source')||':'||(patch.value->>'source_listing_id') then raise exception 'Listing not found'; end if;
  foreach field in array array['source','source_listing_id','seller','seller_id','url'] loop
   if current_listing->field is distinct from patch.value->field then raise exception 'Listing changed; refresh before verifying'; end if;
  end loop;
  if patch.value ? 'interior_photo' and not exists(select 1 from jsonb_array_elements(coalesce(current_listing->'photos','[]')) p where p->>'url'=patch.value->>'interior_photo') then raise exception 'Photo changed; reload the gallery'; end if;
  if exists(select 1 from unnest(array['source','source_listing_id','seller','seller_id','url']) f where scoped->patch.key->f is distinct from patch.value->f) then scoped:=scoped-patch.key; end if;
  -- Deep merge a single listing patch so choosing a photo cannot erase costs,
  -- and verifying one seller cannot erase another seller's confirmations.
  scoped:=jsonb_set(scoped,array[patch.key],coalesce(scoped->patch.key,'{}')||patch.value);
 end loop;
 merged:=(existing-array['price','shipping','mandatory_fees','delivery','photos','listing_verifications'])||(p_overrides-'listing_verifications')||jsonb_build_object('listing_verifications',scoped);
 if octet_length(merged::text)>200000 then raise exception 'Too many listing verifications'; end if;
 update public.vehicles set overrides=merged where id=p_id;
end $$;
revoke all on function public.set_vehicle_decision(uuid,text,integer),public.verify_vehicle(uuid,jsonb) from public,anon;
grant execute on function public.set_vehicle_decision(uuid,text,integer),public.verify_vehicle(uuid,jsonb) to authenticated;

create function public.finalize_vehicle_run(p_run uuid,p_worker uuid,p_lease uuid,p_health jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; item jsonb; prev public.vehicle_listings%rowtype; vid uuid; lid uuid; decision text;
 total integer; previous_total integer; seen text[]:=array[]::text[]; new_eligible integer:=0; changed integer:=0; coverage_status text:=p_health->>'status'; summary jsonb; cfg jsonb;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null then raise exception 'Vehicle run not found'; end if;
 if r.status='completed' then select s.summary into summary from public.vehicle_search_runs s where s.run_id=p_run; return summary; end if;
 if r.status<>'working' then raise exception 'Vehicle run is not active'; end if;
 if coverage_status not in ('success','partial','blocked','failed') then raise exception 'Invalid coverage status'; end if;
 select config into cfg from public.vehicle_profile_versions where profile_id=(r.job_payload->>'profile_id')::uuid and version=(r.job_payload->>'profile_version')::integer and user_id=r.user_id;
 select coalesce(sum(jsonb_array_length(payload)),0) into total from public.vehicle_ingestion_batches where run_id=p_run;
 if total<>coalesce((p_health->'counts'->>'parsed')::integer,-1) or total>10000 then raise exception 'Staged count does not match collector'; end if;
 if p_health->'scope'->>'make' is distinct from cfg->>'make' or p_health->'scope'->>'model' is distinct from cfg->>'model' or p_health->'scope'->>'origin_zip' is distinct from cfg->>'origin_zip' then raise exception 'Collector scope mismatch'; end if;
 if coverage_status='success' and ((p_health->'counts'->>'reported')::integer is distinct from total or coalesce((p_health->'counts'->>'invalid')::integer,0)>0 or coalesce((p_health->'counts'->>'duplicates')::integer,0)>0 or jsonb_array_length(p_health->'warnings')>0) then coverage_status:='partial'; end if;
 select (s.health->'counts'->>'parsed')::integer into previous_total from public.vehicle_search_runs s where s.user_id=r.user_id and s.status='success' and lower(s.health->'scope'->>'make')=lower(cfg->>'make') and lower(s.health->'scope'->>'model')=lower(cfg->>'model') order by s.finished_at desc limit 1;
 if coverage_status='success' and previous_total>=20 and total<previous_total*0.5 then
  coverage_status:='partial'; p_health:=jsonb_set(p_health,'{warnings}',coalesce(p_health->'warnings','[]')||'"sudden_count_drop"'::jsonb);
 end if;
 p_health:=jsonb_set(p_health,'{status}',to_jsonb(coverage_status));
 for item in select value from public.vehicle_ingestion_batches b cross join lateral jsonb_array_elements(b.payload) where b.run_id=p_run order by b.batch_number loop
  if item->>'source'<>'auto.dev' or coalesce(item->>'vin','') !~ '^[A-HJ-NPR-Z0-9]{17}$' or lower(item->>'make')<>lower(cfg->>'make') or lower(item->>'model')<>lower(cfg->>'model') then raise exception 'Invalid normalized listing'; end if;
  if item->>'source_listing_id'=any(seen) then raise exception 'Duplicate listing in run'; end if;
  seen:=array_append(seen,item->>'source_listing_id');
  insert into public.vehicles(user_id,vin,identity_key) values(r.user_id,item->>'vin','vin:'||(item->>'vin')) on conflict(user_id,vin) do update set last_seen_at=now() returning id into vid;
  select v.decision into decision from public.vehicles v where v.id=vid;
  select * into prev from public.vehicle_listings where user_id=r.user_id and source='auto.dev' and source_listing_id=item->>'source_listing_id' for update;
  if (prev.id is null or prev.eligibility<>'eligible') and decision='unreviewed' and item->>'eligibility'='eligible' then new_eligible:=new_eligible+1; end if;
  if prev.id is not null and decision in ('watch','shortlist') and (
   prev.availability is distinct from item->>'availability' or
   (prev.data->'attributes'->>'battery_pack' is null and item->'attributes'->>'battery_pack' is not null) or
   (prev.data->>'shipping' is null and item->>'shipping' is not null) or
   (prev.data->>'mandatory_fees' is null and item->>'mandatory_fees' is not null) or
   (decision='watch' and (prev.data->>'price')::numeric-(item->>'price')::numeric>=greatest(500,(prev.data->>'price')::numeric*0.01)) or
   (decision='shortlist' and (prev.data->'price' is distinct from item->'price' or prev.data->'seller' is distinct from item->'seller' or prev.data->'url' is distinct from item->'url' or prev.data->'shipping' is distinct from item->'shipping' or prev.data->'mandatory_fees' is distinct from item->'mandatory_fees'))
  ) then changed:=changed+1; end if;
  insert into public.vehicle_listings(user_id,vehicle_id,source,source_listing_id,data,eligibility,availability)
   values(r.user_id,vid,'auto.dev',item->>'source_listing_id',item-'eligibility',item->>'eligibility',item->>'availability')
   on conflict(user_id,source,source_listing_id) do update set vehicle_id=excluded.vehicle_id,data=excluded.data,eligibility=excluded.eligibility,availability=excluded.availability,consecutive_absences=0,last_seen_at=now() returning id into lid;
  if prev.id is null or prev.data is distinct from item-'eligibility' then insert into public.vehicle_listing_observations(user_id,listing_id,data) values(r.user_id,lid,item-'eligibility'); end if;
 end loop;
 -- Only a complete successful enumeration can advance absence counters, and
 -- only for this make/model. A failed or partial run never removes inventory.
 if coverage_status='success' then
  for prev in select l.* from public.vehicle_listings l where l.user_id=r.user_id and l.source='auto.dev' and lower(l.data->>'make')=lower(cfg->>'make') and lower(l.data->>'model')=lower(cfg->>'model') and not(l.source_listing_id=any(seen)) and l.consecutive_absences>=1 and l.availability='available' loop
   insert into public.vehicle_listing_observations(user_id,listing_id,data) values(r.user_id,prev.id,prev.data||jsonb_build_object('availability','unavailable'));
   if exists(select 1 from public.vehicles v where v.id=prev.vehicle_id and v.decision in ('watch','shortlist')) then changed:=changed+1; end if;
  end loop;
  update public.vehicle_listings set consecutive_absences=consecutive_absences+1,availability=case when consecutive_absences>=1 then 'unavailable' else availability end,data=case when consecutive_absences>=1 then jsonb_set(data,'{availability}','"unavailable"') else data end
   where user_id=r.user_id and source='auto.dev' and lower(data->>'make')=lower(cfg->>'make') and lower(data->>'model')=lower(cfg->>'model') and not(source_listing_id=any(seen));
 end if;
 summary:=jsonb_build_object('imported',total,'new_eligible',new_eligible,'watched_changes',changed,'status',coverage_status,'url','/vehicles');
 insert into public.vehicle_search_runs(run_id,user_id,profile_id,profile_version,status,health,summary) values(p_run,r.user_id,(r.job_payload->>'profile_id')::uuid,(r.job_payload->>'profile_version')::integer,coverage_status,p_health,summary);
 delete from public.vehicle_ingestion_batches where run_id=p_run;
 update public.runs set status='completed',finished_at=now(),result_markdown=format('Vehicle search: %s. %s listings; %s new eligible; %s watched changes. [Review vehicles](/vehicles)',coverage_status,total,new_eligible,changed) where id=p_run;
 update public.tasks set status=case when coverage_status='success' then 'done'::public.task_status else 'waiting'::public.task_status end where id=r.task_id;
 insert into public.events(task_id,run_id,user_id,type,payload) values(r.task_id,r.id,r.user_id,'vehicles.completed',summary);
 if coverage_status<>'success' or new_eligible>0 or changed>0 then
  insert into public.push_deliveries(subscription_id,run_id,task_id,outcome) select s.id,r.id,r.task_id,case when coverage_status='success' then 'completed' else 'failed' end from public.push_subscriptions s where s.user_id=r.user_id on conflict do nothing;
 end if;
 return summary;
end $$;

-- Generic completion notifications are suppressed for vehicle jobs. Their
-- finalizer writes at most one meaningful digest into the existing outbox.
create or replace function public.enqueue_run_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.job_kind='vehicle_search' then return new; end if;
 if new.status in ('completed','failed') and old.status is distinct from new.status then
  insert into public.push_deliveries(subscription_id,run_id,task_id,outcome) select s.id,new.id,new.task_id,new.status::text from public.push_subscriptions s where s.user_id=new.user_id on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.claim_vehicle_run(uuid),public.stage_vehicle_batch(uuid,uuid,uuid,integer,jsonb),public.finalize_vehicle_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_vehicle_run(uuid),public.stage_vehicle_batch(uuid,uuid,uuid,integer,jsonb),public.finalize_vehicle_run(uuid,uuid,uuid,jsonb) to service_role;

create function public.import_vehicle_listing(p_listing jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); vid uuid; lid uuid; known_vin text:=nullif(p_listing->>'vin',''); identity text; previous jsonb;
begin
 if uid is null then raise exception 'Sign in required'; end if;
 if p_listing->>'source'<>'manual' or length(coalesce(p_listing->>'source_listing_id','')) not between 1 and 200 or length(coalesce(p_listing->>'make','')) not between 1 and 80 or length(coalesce(p_listing->>'model','')) not between 1 and 80 or octet_length(p_listing::text)>50000 then raise exception 'Invalid manual listing'; end if;
 identity:=case when known_vin is not null then 'vin:'||known_vin else 'manual:'||md5(p_listing->>'source_listing_id') end;
 -- Stable manual URL/stock identity allows later VIN confirmation. Lock the
 -- owner to serialize provisional-to-canonical merges with manual imports.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select vehicle_id into vid from public.vehicle_listings where user_id=uid and source='manual' and source_listing_id=p_listing->>'source_listing_id' for update;
 if vid is null then
  insert into public.vehicles(user_id,vin,identity_key) values(uid,known_vin,identity) on conflict(user_id,identity_key) do update set last_seen_at=now() returning id into vid;
 end if;
 select data into previous from public.vehicle_listings where user_id=uid and source='manual' and source_listing_id=p_listing->>'source_listing_id';
 insert into public.vehicle_listings(user_id,vehicle_id,source,source_listing_id,data,eligibility,availability) values(uid,vid,'manual',p_listing->>'source_listing_id',p_listing,'needs_verification',p_listing->>'availability')
  on conflict(user_id,source,source_listing_id) do update set data=excluded.data,last_seen_at=now() returning id into lid;
 if previous is distinct from p_listing then insert into public.vehicle_listing_observations(user_id,listing_id,data) values(uid,lid,p_listing); end if;
 if known_vin is not null then return public.confirm_vehicle_vin(vid,known_vin); end if;
 return vid;
end $$;
revoke all on function public.import_vehicle_listing(jsonb) from public,anon;
grant execute on function public.import_vehicle_listing(jsonb) to authenticated;

create function public.confirm_vehicle_vin(p_id uuid,p_vin text) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); src public.vehicles%rowtype; dst public.vehicles%rowtype;
begin
 if uid is null or p_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then raise exception 'Invalid VIN'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into src from public.vehicles where id=p_id and user_id=uid for update;
 if src.id is null then raise exception 'Vehicle not found'; end if;
 if src.vin is not null and src.vin<>p_vin then raise exception 'A confirmed VIN cannot be replaced'; end if;
 select * into dst from public.vehicles where user_id=uid and vin=p_vin for update;
 if dst.id is null or dst.id=src.id then
  update public.vehicles set vin=p_vin,identity_key='vin:'||p_vin where id=src.id;
  update public.vehicle_listings set data=jsonb_set(data,'{vin}',to_jsonb(p_vin)) where vehicle_id=src.id;
  return src.id;
 end if;
 update public.vehicles set
  decision=case when src.decision='passed' or dst.decision='passed' then 'passed' when src.decision_at>coalesce(dst.decision_at,'-infinity'::timestamptz) then src.decision else dst.decision end,
  decision_at=greatest(src.decision_at,dst.decision_at),decision_revision=greatest(src.decision_revision,dst.decision_revision)+1,
  overrides=src.overrides||dst.overrides||jsonb_build_object('listing_verifications',coalesce(src.overrides->'listing_verifications','{}')||coalesce(dst.overrides->'listing_verifications','{}')),first_seen_at=least(src.first_seen_at,dst.first_seen_at),last_seen_at=greatest(src.last_seen_at,dst.last_seen_at) where id=dst.id;
 update public.vehicle_listings set vehicle_id=dst.id,data=jsonb_set(data,'{vin}',to_jsonb(p_vin)) where vehicle_id=src.id;
 delete from public.vehicles where id=src.id;
 return dst.id;
end $$;
revoke all on function public.confirm_vehicle_vin(uuid,text) from public,anon;
grant execute on function public.confirm_vehicle_vin(uuid,text) to authenticated;

create function public.fail_vehicle_run(p_run uuid,p_worker uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; cfg jsonb; result jsonb;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null then raise exception 'Active vehicle run not found'; end if;
 if r.status='completed' then select summary into result from public.vehicle_search_runs where run_id=p_run; return result; end if;
 if r.job_payload->>'photo_vin' is not null and r.status='failed' then return jsonb_build_object('photos','failed'); end if;
 if r.status<>'working' then raise exception 'Active vehicle run not found'; end if;
 if r.job_payload->>'photo_vin' is not null then
  -- An optional image request is not a failed inventory enumeration. Preserve
  -- coverage health and absence counts; surface the retry on its own task.
  update public.runs set status='failed',finished_at=now(),error='Vehicle photo gallery could not be loaded. Open the original listing or retry.' where id=p_run;
  update public.tasks set status='waiting' where id=r.task_id;
  insert into public.events(task_id,run_id,user_id,type,payload) values(r.task_id,r.id,r.user_id,'run.failed',jsonb_build_object('attempt',r.attempt,'error','Vehicle photo gallery unavailable'));
  return jsonb_build_object('photos','failed');
 end if;
 select config into cfg from public.vehicle_profile_versions where profile_id=(r.job_payload->>'profile_id')::uuid and version=(r.job_payload->>'profile_version')::integer and user_id=r.user_id;
 delete from public.vehicle_ingestion_batches where run_id=p_run;
 result:=public.finalize_vehicle_run(p_run,p_worker,p_lease,jsonb_build_object('version',1,'source','auto.dev','status','failed','scope',cfg,'counts',jsonb_build_object('parsed',0,'reported',null,'discovered',0,'pages',0,'requests',0,'invalid',0,'duplicates',0),'warnings',jsonb_build_array('worker_collection_or_ingestion_failed')));
 return result;
end $$;
revoke all on function public.fail_vehicle_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fail_vehicle_run(uuid,uuid,uuid) to service_role;

create function public.request_vehicle_photos(p_vehicle uuid,p_profile uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); vid text; cfg public.vehicle_search_profiles%rowtype; tid uuid;
begin
 select vin into vid from public.vehicles where id=p_vehicle and user_id=uid;
 select * into cfg from public.vehicle_search_profiles where id=p_profile and user_id=uid;
 if uid is null or vid is null or cfg.id is null then raise exception 'VIN-backed vehicle and profile required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||vid,0));
 select task_id into tid from public.runs where user_id=uid and job_kind='vehicle_search' and job_payload->>'photo_vin'=vid and status in ('queued','working') limit 1;
 if tid is not null then return tid; end if;
 insert into public.tasks(user_id,title,instructions,deliverable,status,job_kind,job_payload) values(uid,'Vehicle photos','Load requested Auto.dev listing photos.','investigation','ready','vehicle_search',jsonb_build_object('profile_id',cfg.id,'profile_version',cfg.version,'photo_vin',vid)) returning id into tid;
 insert into public.runs(user_id,task_id,attempt,deliverable) values(uid,tid,1,'investigation');
 return tid;
end $$;
revoke all on function public.request_vehicle_photos(uuid,uuid) from public,anon;
grant execute on function public.request_vehicle_photos(uuid,uuid) to authenticated;

create function public.complete_vehicle_photos(p_run uuid,p_worker uuid,p_lease uuid,p_photos jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null or r.job_payload->>'photo_vin' is null then raise exception 'Photo run not found'; end if;
 if r.status='completed' then return; end if;
 if r.status<>'working' or jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>50 then raise exception 'Invalid photo result'; end if;
 update public.vehicle_listings set data=jsonb_set(data,'{photos}',p_photos) where user_id=r.user_id and source='auto.dev' and data->>'vin'=r.job_payload->>'photo_vin';
 update public.runs set status='completed',finished_at=now(),result_markdown='[Vehicle photos ready](/vehicles)' where id=p_run;
 update public.tasks set status='done' where id=r.task_id;
end $$;
revoke all on function public.complete_vehicle_photos(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_vehicle_photos(uuid,uuid,uuid,jsonb) to service_role;

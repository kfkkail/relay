-- Durable seller evidence is separate from source snapshots and owner overrides.
alter table public.vehicles add column enrichment jsonb not null default '{}'::jsonb;

create function public.request_vehicle_enrichment(p_vehicle uuid,p_profile uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); v public.vehicles%rowtype; cfg public.vehicle_search_profiles%rowtype;
 l public.vehicle_listings%rowtype; tid uuid;
begin
 select * into cfg from public.vehicle_search_profiles where id=p_profile and user_id=uid;
 select * into v from public.vehicles where id=p_vehicle and user_id=uid for update;
 if uid is null or v.vin is null or cfg.id is null or v.decision not in ('watch','shortlist') then raise exception 'Choose an Interested or Shortlist vehicle with a confirmed VIN'; end if;
 select * into l from public.vehicle_listings where vehicle_id=v.id and user_id=uid
  and source='auto.dev' and availability='available' and data->>'url' ~ '^https?://'
  and lower(data->>'make')='rivian' and lower(data->>'model')='r1t'
  order by last_seen_at desc,id limit 1;
 if l.id is null then raise exception 'An available R1T seller listing is required'; end if;
 -- The vehicle lock serializes both automatic and manual requests.
 select task_id into tid from public.runs where user_id=uid and job_kind='vehicle_search'
  and job_payload->>'detail_vehicle'=v.id::text and status in ('queued','working') limit 1;
 if tid is not null then return tid; end if;
 insert into public.tasks(user_id,title,instructions,deliverable,status,job_kind,job_payload)
 values(uid,'Vehicle configuration','Check explicit battery and motor evidence on the public seller page.','investigation','ready','vehicle_search',
  jsonb_build_object('profile_id',cfg.id,'profile_version',cfg.version,'detail_vehicle',v.id,'detail_vin',v.vin,'detail_listing',l.id,'detail_url',l.data->>'url')) returning id into tid;
 insert into public.runs(user_id,task_id,attempt,deliverable) values(uid,tid,1,'investigation');
 update public.vehicles set enrichment=enrichment||jsonb_build_object('status','queued','task_id',tid,'requested_at',now()) where id=v.id;
 return tid;
end $$;
revoke all on function public.request_vehicle_enrichment(uuid,uuid) from public,anon;
grant execute on function public.request_vehicle_enrichment(uuid,uuid) to authenticated;

-- Workers predating this feature must not mistake a detail job for a full scan.
create function public.claim_vehicle_run(p_worker_id uuid,p_enrichment boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; uid uuid; cfg jsonb;
begin
 select user_id into uid from public.workers where id=p_worker_id and revoked_at is null;
 if uid is null then raise exception 'worker unavailable'; end if;
 for r in select * from public.runs where user_id=uid and job_kind='vehicle_search' and status='working' and coalesce(vehicle_heartbeat_at,started_at)<now()-interval '15 minutes' for update skip locked loop
  delete from public.vehicle_ingestion_batches where run_id=r.id;
  update public.runs set status='queued',worker_id=null,started_at=null where id=r.id;
 end loop;
 select * into r from public.runs where user_id=uid and job_kind='vehicle_search' and status='queued'
  and (p_enrichment or job_payload->>'detail_vehicle' is null)
  order by queued_at for update skip locked limit 1;
 if r.id is null then return null; end if;
 select config into cfg from public.vehicle_profile_versions where profile_id=(r.job_payload->>'profile_id')::uuid and version=(r.job_payload->>'profile_version')::integer and user_id=uid;
 if cfg is null then raise exception 'Vehicle profile revision missing'; end if;
 update public.runs set status='working',worker_id=p_worker_id,started_at=now(),vehicle_heartbeat_at=now(),vehicle_lease=gen_random_uuid() where id=r.id returning vehicle_lease into r.vehicle_lease;
 update public.tasks set status='working' where id=r.task_id;
 return jsonb_build_object('run',jsonb_build_object('id',r.id,'attempt',r.attempt,'job_kind','vehicle_search','job_payload',r.job_payload,'lease',r.vehicle_lease),'task',jsonb_build_object('id',r.task_id),'profile',cfg,'attachments','[]'::jsonb);
end $$;
revoke all on function public.claim_vehicle_run(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_vehicle_run(uuid,boolean) to service_role;
create or replace function public.claim_vehicle_run(p_worker_id uuid) returns jsonb
language sql security definer set search_path='' as $$select public.claim_vehicle_run(p_worker_id,false)$$;

create function public.complete_vehicle_enrichment(p_run uuid,p_worker uuid,p_lease uuid,p_attributes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; l public.vehicle_listings%rowtype; v public.vehicles%rowtype; state text; attrs jsonb:='{}';
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null or r.job_payload->>'detail_vehicle' is null then raise exception 'Enrichment run not found'; end if;
 if r.status='completed' then return; end if;
 if r.status<>'working' or p_attributes is null or jsonb_typeof(p_attributes)<>'object' or octet_length(p_attributes::text)>6000 then raise exception 'Invalid enrichment result'; end if;
 select * into v from public.vehicles where id=(r.job_payload->>'detail_vehicle')::uuid and user_id=r.user_id for update;
 select * into l from public.vehicle_listings where id=(r.job_payload->>'detail_listing')::uuid and vehicle_id=v.id and user_id=r.user_id;
 if v.id is null or v.vin is distinct from r.job_payload->>'detail_vin' or l.id is null or l.data->>'url' is distinct from r.job_payload->>'detail_url' then raise exception 'Listing changed; retry configuration check'; end if;
 if p_attributes->>'battery_pack' in ('standard','standard+','large','max') and length(p_attributes->>'battery_evidence') between 1 and 1500 then
  attrs:=attrs||jsonb_build_object('battery_pack',p_attributes->>'battery_pack','battery_evidence',p_attributes->>'battery_evidence');
 end if;
 if p_attributes->>'motor' in ('dual','quad','tri') and length(p_attributes->>'motor_evidence') between 1 and 1500 then
  attrs:=attrs||jsonb_build_object('motor',p_attributes->>'motor','motor_evidence',p_attributes->>'motor_evidence');
 end if;
 state:=case when attrs ? 'battery_pack' and attrs ? 'motor' then 'resolved' when attrs<>'{}'::jsonb then 'partial' else 'unresolved' end;
 update public.vehicles set enrichment=enrichment||jsonb_build_object('status',state,'checked_at',now(),'source_url',r.job_payload->>'detail_url',
  'attributes',coalesce(enrichment->'attributes','{}')||attrs) where id=v.id;
 update public.runs set status='completed',finished_at=now(),result_markdown='[Vehicle configuration checked](/vehicles)' where id=p_run;
 update public.tasks set status='done' where id=r.task_id;
end $$;
revoke all on function public.complete_vehicle_enrichment(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_vehicle_enrichment(uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.fail_vehicle_run(p_run uuid,p_worker uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; cfg jsonb; result jsonb;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null then raise exception 'Active vehicle run not found'; end if;
 if r.job_payload->>'detail_vehicle' is not null then
  if r.status in ('completed','failed') then return jsonb_build_object('enrichment',r.status); end if;
  if r.status<>'working' then raise exception 'Active vehicle run not found'; end if;
  update public.vehicles set enrichment=enrichment||jsonb_build_object('status','failed','checked_at',now())
   where id=(r.job_payload->>'detail_vehicle')::uuid and user_id=r.user_id and enrichment->>'task_id'=r.task_id::text;
  update public.runs set status='failed',finished_at=now(),error='Configuration could not be checked. Retry Check battery & motor or verify manually.' where id=p_run;
  update public.tasks set status='waiting' where id=r.task_id;
  return jsonb_build_object('enrichment','failed');
 end if;
 if r.status='completed' then select summary into result from public.vehicle_search_runs where run_id=p_run; return result; end if;
 if r.job_payload->>'photo_vin' is not null and r.status='failed' then return jsonb_build_object('photos','failed'); end if;
 if r.status<>'working' then raise exception 'Active vehicle run not found'; end if;
 if r.job_payload->>'photo_vin' is not null then
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

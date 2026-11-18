-- Preserve bounded failure diagnostics without treating a blocked seller as a
-- failed inventory scan or discarding any configuration evidence already held.
create function public.fail_vehicle_enrichment(p_run uuid,p_worker uuid,p_lease uuid,p_failure jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.runs%rowtype; code text:=p_failure->>'code'; host text:=p_failure->>'host';
 state text; message text; diagnostic jsonb; http_status integer;
begin
 select * into r from public.runs where id=p_run and worker_id=p_worker and vehicle_lease=p_lease and job_kind='vehicle_search' for update;
 if r.id is null or r.job_payload->>'detail_vehicle' is null then raise exception 'Enrichment run not found'; end if;
 if r.status in ('completed','failed') then return; end if;
 if r.status<>'working' then raise exception 'Active enrichment run not found'; end if;
 if p_failure is null or jsonb_typeof(p_failure)<>'object' or octet_length(p_failure::text)>1000
  or code is null or code not in ('access_denied','rate_limited','http_error','timeout','unsafe_destination','response_too_large','request_limit','network_error')
  or host is null or host !~ '^[a-zA-Z0-9.-]{1,253}$'
  or (p_failure ? 'http_status' and (jsonb_typeof(p_failure->'http_status')<>'number' or (p_failure->>'http_status')::integer not between 400 and 599))
  or (p_failure ? 'network_code' and coalesce(p_failure->>'network_code','') !~ '^[A-Z0-9_]{1,40}$')
 then raise exception 'Invalid enrichment failure'; end if;
 http_status:=(p_failure->>'http_status')::integer;
 diagnostic:=jsonb_strip_nulls(jsonb_build_object('code',code,'host',host,'http_status',http_status,'network_code',p_failure->>'network_code'));
 state:=case when code in ('access_denied','rate_limited') then 'blocked' else 'failed' end;
 message:=host||': '||case code
  when 'access_denied' then 'seller denied automated access'
  when 'rate_limited' then 'seller rate limited the request'
  when 'http_error' then 'seller returned an unsuccessful response'
  when 'timeout' then 'seller request timed out'
  when 'unsafe_destination' then 'destination failed public-network checks'
  when 'response_too_large' then 'seller response exceeded the size limit'
  when 'request_limit' then 'page exceeded the request limit'
  else 'seller request failed' end
  ||case when http_status is not null then ' (HTTP '||http_status||')' else '' end
  ||case when diagnostic ? 'network_code' then ' ('||(diagnostic->>'network_code')||')' else '' end;
 update public.vehicles set enrichment=enrichment||jsonb_build_object('status',state,'failure',diagnostic,'checked_at',now())
  where id=(r.job_payload->>'detail_vehicle')::uuid and user_id=r.user_id and enrichment->>'task_id'=r.task_id::text;
 update public.runs set status='failed',finished_at=now(),error=message where id=p_run;
 update public.tasks set status='waiting' where id=r.task_id;
end $$;
revoke all on function public.fail_vehicle_enrichment(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fail_vehicle_enrichment(uuid,uuid,uuid,jsonb) to service_role;

-- A fresh request must not display the prior attempt's HTTP status if the new
-- attempt later fails for a different reason (for example browser startup).
create or replace function public.request_vehicle_enrichment(p_vehicle uuid,p_profile uuid) returns uuid
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
 select task_id into tid from public.runs where user_id=uid and job_kind='vehicle_search'
  and job_payload->>'detail_vehicle'=v.id::text and status in ('queued','working') limit 1;
 if tid is not null then return tid; end if;
 insert into public.tasks(user_id,title,instructions,deliverable,status,job_kind,job_payload)
 values(uid,'Vehicle configuration','Check explicit battery and motor evidence on the public seller page.','investigation','ready','vehicle_search',
  jsonb_build_object('profile_id',cfg.id,'profile_version',cfg.version,'detail_vehicle',v.id,'detail_vin',v.vin,'detail_listing',l.id,'detail_url',l.data->>'url')) returning id into tid;
 insert into public.runs(user_id,task_id,attempt,deliverable) values(uid,tid,1,'investigation');
 update public.vehicles set enrichment=(enrichment-'failure')||jsonb_build_object('status','queued','task_id',tid,'requested_at',now()) where id=v.id;
 return tid;
end $$;

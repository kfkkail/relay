-- Recurrence creates ordinary tasks. Cron performs no external requests.
create table public.task_schedules (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160),
 instructions text not null check(char_length(instructions) between 1 and 100000),
 deliverable text not null check(deliverable in ('implementation_pr','proposal','investigation')),
 timezone text not null,
 weekdays integer[] not null check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]),
 interval_minutes integer not null check(interval_minutes in (30,60,1440)),
 start_minute integer not null check(start_minute between 0 and 1439),
 end_minute integer not null check(end_minute between 1 and 1440 and end_minute > start_minute),
 enabled boolean not null default false,
 archived boolean not null default false,
 next_due_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.task_schedules enable row level security;
create policy "owners read schedules" on public.task_schedules for select using(user_id=auth.uid());
revoke all on public.task_schedules from anon, authenticated;
grant select on public.task_schedules to authenticated;

alter table public.tasks add column schedule_id uuid references public.task_schedules(id) on delete set null;
create index tasks_schedule_idx on public.tasks(schedule_id);
create table public.schedule_occurrences (
 id uuid primary key default gen_random_uuid(),
 schedule_id uuid not null references public.task_schedules(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 due_at timestamptz not null,
 task_id uuid references public.tasks(id) on delete set null,
 trigger text not null check(trigger in ('scheduled','manual')),
 request_id uuid,
 created_at timestamptz not null default now()
);
create unique index scheduled_occurrence_slot on public.schedule_occurrences(schedule_id,due_at) where trigger='scheduled';
create unique index manual_occurrence_request on public.schedule_occurrences(schedule_id,request_id) where trigger='manual';
alter table public.schedule_occurrences enable row level security;
create policy "owners read occurrences" on public.schedule_occurrences for select using(user_id=auth.uid());
revoke all on public.schedule_occurrences from anon,authenticated;
grant select on public.schedule_occurrences to authenticated;

-- Local slots anchor to the window start. Skip nonexistent DST slots; the
-- PostgreSQL standard-time interpretation chooses one repeated slot in autumn.
create function public.next_schedule_slot(p_zone text,p_days integer[],p_interval integer,p_start integer,p_end integer,p_after timestamptz)
returns timestamptz language sql stable set search_path='' as $$
 select min(instant) from (
  select local_slot, local_slot at time zone p_zone as instant from (
   select ((p_after at time zone p_zone)::date + d)::timestamp + m * interval '1 minute' as local_slot
   from generate_series(0,8) d cross join generate_series(p_start,case when p_interval=1440 then p_start else p_end-1 end,p_interval) m
   where extract(dow from (p_after at time zone p_zone)::date + d)::integer=any(p_days)
  ) slots
 ) candidates where instant>p_after and instant at time zone p_zone=local_slot;
$$;

create function public.save_task_schedule(p_id uuid,p_config jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.task_schedules%rowtype; sid uuid; uid uuid:=auth.uid();
begin
 if uid is null then raise exception 'Sign in required'; end if;
 if p_id is not null then
  select * into s from public.task_schedules where id=p_id and user_id=uid for update;
  if not found then raise exception 'Schedule not found'; end if;
 end if;
 if not exists(select 1 from pg_timezone_names where name=p_config->>'timezone') then raise exception 'Invalid timezone'; end if;
 s.title:=trim(p_config->>'title'); s.instructions:=trim(p_config->>'instructions'); s.deliverable:=p_config->>'deliverable';
 s.timezone:=p_config->>'timezone'; s.weekdays:=array(select jsonb_array_elements_text(p_config->'weekdays')::integer);
 s.interval_minutes:=(p_config->>'interval_minutes')::integer; s.start_minute:=(p_config->>'start_minute')::integer; s.end_minute:=(p_config->>'end_minute')::integer;
 s.enabled:=(p_config->>'enabled')::boolean; s.archived:=coalesce((p_config->>'archived')::boolean,false);
 if s.interval_minutes is null or s.interval_minutes not in (30,60,1440) or cardinality(s.weekdays) not between 1 and 7 or not s.weekdays <@ array[0,1,2,3,4,5,6] or s.start_minute is null or s.end_minute is null or s.start_minute<0 or s.end_minute>1440 or s.start_minute>=s.end_minute then raise exception 'Invalid recurrence'; end if;
 s.next_due_at:=public.next_schedule_slot(s.timezone,s.weekdays,s.interval_minutes,s.start_minute,s.end_minute,now());
 if p_id is null then
  insert into public.task_schedules(user_id,title,instructions,deliverable,timezone,weekdays,interval_minutes,start_minute,end_minute,enabled,archived,next_due_at)
  values(uid,s.title,s.instructions,s.deliverable,s.timezone,s.weekdays,s.interval_minutes,s.start_minute,s.end_minute,s.enabled,s.archived,s.next_due_at) returning id into sid;
 else
  -- Lock queued runs before cancellation so a claim either wins or observes cancellation.
  perform r.id from public.runs r join public.tasks t on t.id=r.task_id where t.schedule_id=p_id and r.status='queued' for update of r;
  update public.runs r set status='cancelled',finished_at=now() from public.tasks t where t.id=r.task_id and t.schedule_id=p_id and r.status='queued';
  update public.tasks t set status='inbox' where t.schedule_id=p_id and t.status='ready' and not exists(select 1 from public.runs r where r.task_id=t.id and r.status in ('queued','working'));
  update public.task_schedules set title=s.title,instructions=s.instructions,deliverable=s.deliverable,timezone=s.timezone,weekdays=s.weekdays,interval_minutes=s.interval_minutes,start_minute=s.start_minute,end_minute=s.end_minute,enabled=s.enabled,archived=s.archived,next_due_at=s.next_due_at where id=p_id;
  sid:=p_id;
 end if;
 return sid;
end; $$;

-- All task runs, including feedback reruns, acquire the schedule lock. This
-- extends the existing one-active-run-per-task guarantee across occurrences.
create function public.guard_schedule_run() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 select schedule_id into sid from public.tasks where id=new.task_id;
 if sid is not null and new.status in ('queued','working') and (TG_OP='INSERT' or old.status not in ('queued','working')) then
  perform 1 from public.task_schedules where id=sid for update;
  if exists(select 1 from public.runs r join public.tasks t on t.id=r.task_id where t.schedule_id=sid and r.id<>new.id and r.status in ('queued','working')) then
   raise exception 'This schedule already has an active run';
  end if;
 end if;
 return new;
end; $$;
create trigger guard_schedule_run before insert or update of status on public.runs for each row execute function public.guard_schedule_run();

create function public.materialize_schedule(p_id uuid,p_manual boolean default false,p_request uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.task_schedules%rowtype; tid uuid; rid uuid; local_now timestamp;
begin
 select * into s from public.task_schedules where id=p_id for update;
 if not found or s.archived then return null; end if;
 if p_manual then
  if p_request is null then raise exception 'Request ID required'; end if;
  select task_id into tid from public.schedule_occurrences where schedule_id=p_id and request_id=p_request and trigger='manual';
  if found then return tid; end if;
 else
  if not s.enabled or s.next_due_at>now() then return null; end if;
  local_now:=now() at time zone s.timezone;
  if not extract(dow from local_now)::integer=any(s.weekdays) or extract(hour from local_now)*60+extract(minute from local_now)<s.start_minute or (s.interval_minutes<>1440 and extract(hour from local_now)*60+extract(minute from local_now)>=s.end_minute) then return null; end if;
 end if;
 if exists(select 1 from public.runs r join public.tasks t on t.id=r.task_id where t.schedule_id=p_id and r.status in ('queued','working')) then return null; end if;
 insert into public.tasks(user_id,title,instructions,deliverable,status,schedule_id) values(s.user_id,s.title,s.instructions,s.deliverable,'ready',s.id) returning id into tid;
 insert into public.runs(task_id,user_id,attempt,deliverable) values(tid,s.user_id,1,s.deliverable) returning id into rid;
 insert into public.schedule_occurrences(schedule_id,user_id,due_at,task_id,trigger,request_id) values(s.id,s.user_id,case when p_manual then now() else s.next_due_at end,tid,case when p_manual then 'manual' else 'scheduled' end,p_request);
 insert into public.events(task_id,run_id,user_id,type,payload) values(tid,rid,s.user_id,'run.queued',jsonb_build_object('scheduleId',s.id,'manual',p_manual));
 if not p_manual then update public.task_schedules set next_due_at=public.next_schedule_slot(s.timezone,s.weekdays,s.interval_minutes,s.start_minute,s.end_minute,now()) where id=s.id; end if;
 return tid;
end; $$;
create function public.run_task_schedule(p_id uuid,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.task_schedules where id=p_id and user_id=auth.uid()) then raise exception 'Schedule not found'; end if;
 return public.materialize_schedule(p_id,true,p_request);
end; $$;
create function public.dispatch_task_schedules() returns integer language plpgsql security definer set search_path='' as $$
declare s record; n integer:=0;
begin
 for s in select id from public.task_schedules where enabled and not archived and next_due_at<=now() order by next_due_at for update skip locked limit 100 loop
  if public.materialize_schedule(s.id) is not null then n:=n+1; end if;
 end loop;
 return n;
end; $$;
revoke all on function public.save_task_schedule(uuid,jsonb),public.run_task_schedule(uuid,uuid),public.materialize_schedule(uuid,boolean,uuid),public.dispatch_task_schedules(),public.guard_schedule_run() from public,anon,authenticated;
grant execute on function public.save_task_schedule(uuid,jsonb),public.run_task_schedule(uuid,uuid) to authenticated;
select cron.schedule('relay-task-schedules','* * * * *','select public.dispatch_task_schedules()');

revoke all on function public.next_schedule_slot(text,integer[],integer,integer,integer,timestamptz) from public,anon,authenticated;
create function public.preview_task_schedule(p_config jsonb) returns setof timestamptz language plpgsql security definer set search_path='' as $$
declare zone text:=p_config->>'timezone'; days integer[]:=array(select jsonb_array_elements_text(p_config->'weekdays')::integer); step integer:=(p_config->>'interval_minutes')::integer; first_min integer:=(p_config->>'start_minute')::integer; last_min integer:=(p_config->>'end_minute')::integer; slot timestamptz:=now();
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if zone is null or not exists(select 1 from pg_timezone_names where name=zone) or step is null or step not in (30,60,1440) or cardinality(days) not between 1 and 7 or not days <@ array[0,1,2,3,4,5,6] or first_min is null or last_min is null or first_min<0 or last_min>1440 or first_min>=last_min then raise exception 'Invalid recurrence'; end if;
 for i in 1..3 loop slot:=public.next_schedule_slot(zone,days,step,first_min,last_min,slot); return next slot; end loop;
end; $$;
revoke all on function public.preview_task_schedule(jsonb) from public,anon;
grant execute on function public.preview_task_schedule(jsonb) to authenticated;

create function public.guard_task_schedule_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.schedule_id is distinct from old.schedule_id and (new.schedule_id is not null or exists(select 1 from public.task_schedules where id=old.schedule_id)) then raise exception 'Schedule links cannot be changed'; end if;
 if new.schedule_id is not null and not exists(select 1 from public.task_schedules where id=new.schedule_id and user_id=new.user_id) then raise exception 'Schedule not found'; end if;
 return new;
end; $$;
revoke all on function public.guard_task_schedule_owner() from public,anon,authenticated;
create trigger guard_task_schedule_owner before insert or update of schedule_id,user_id on public.tasks for each row execute function public.guard_task_schedule_owner();

-- Explicit grants for embedded occurrence history on fresh installations.
grant select on public.tasks, public.runs to authenticated;

-- Daily pushes retain claim-before-send semantics across Edge restarts.
begin;

create table public.daily_reminder_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  slot time not null,
  expo_push_token text not null,
  status text not null default 'pending' check (status in
    ('pending', 'sending', 'accepted', 'rejected', 'unknown', 'skipped')),
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  unique(user_id, local_date, slot, expo_push_token)
);
create index daily_reminder_outbox_pending on public.daily_reminder_outbox(id)
  where status = 'pending';
create index daily_reminder_outbox_sending on public.daily_reminder_outbox(claimed_at)
  where status = 'sending';
alter table public.daily_reminder_outbox enable row level security;
revoke all on public.daily_reminder_outbox from public, anon, authenticated;

create function public.edge_worker_enqueue_reminders(
  p_at timestamptz default null, p_window integer default 15
)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_inserted integer;
begin
  if p_window is null or p_window not between 1 and 60 then
    raise exception 'Invalid reminder window';
  end if;
  with clock as (
    select coalesce(p_at, clock_timestamp()) as t
  ), candidates as (
    select p.id as user_id, (clock.t at time zone p.timezone) as local_now,
      np.reminder_times
      from public.profiles p
      join public.notification_preferences np on np.user_id = p.id
      cross join clock where np.enabled
  ), occurrences as (
    select c.user_id, c.local_now, s.slot, d.day as local_date,
      d.day + s.slot as slot_at
      from candidates c
      cross join lateral unnest(c.reminder_times) as s(slot)
      cross join lateral (values
        (c.local_now::date), (c.local_now::date - 1)) as d(day)
  ), due as (
    select distinct o.user_id, o.local_date, o.slot from occurrences o
     where o.slot_at <= o.local_now
       and o.slot_at > o.local_now - make_interval(mins => p_window)
       and exists (select 1 from public.user_topics ut
         join public.topics t on t.id = ut.topic_id and t.is_active
         where ut.user_id = o.user_id)
       and exists (select 1 from public.device_tokens dt where dt.user_id = o.user_id)
       and not exists (select 1 from public.daily_assignments da
         where da.user_id = o.user_id and da.assigned_for = o.local_date
           and da.completed_at is not null)
       and not exists (select 1 from public.daily_reviews r
         where r.user_id = o.user_id and r.assigned_for = o.local_date
           and r.completed_at is not null)
       and not exists (select 1 from public.daily_assignments da
         where da.user_id = o.user_id and da.assigned_for = o.local_now::date
           and da.completed_at is not null)
       and not exists (select 1 from public.daily_reviews r
         where r.user_id = o.user_id and r.assigned_for = o.local_now::date
           and r.completed_at is not null)
  ), claimed as (
    insert into public.reminder_log(user_id,local_date,slot)
      select user_id,local_date,slot from due
      on conflict do nothing returning user_id,local_date,slot
  )
  insert into public.daily_reminder_outbox(user_id,local_date,slot,expo_push_token)
    select c.user_id,c.local_date,c.slot,d.expo_push_token
      from claimed c join public.device_tokens d on d.user_id = c.user_id
    on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$$;

create function public.edge_worker_claim_reminders(
  p_limit integer default 100, p_at timestamptz default null
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_at timestamptz := coalesce(p_at, clock_timestamp());
declare v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Reminder batch must contain 1–100 tokens';
  end if;
  -- Recheck live opt-in, handset ownership, topic follows and completion.
  -- A queued push older than half an hour is no longer a useful nudge.
  update public.daily_reminder_outbox o set status = 'skipped', finished_at = v_at
    where o.status = 'pending' and (
      o.queued_at < v_at - interval '30 minutes'
      or not exists (select 1 from public.device_tokens d
        where d.user_id = o.user_id and d.expo_push_token = o.expo_push_token)
      or not exists (select 1 from public.notification_preferences n
        where n.user_id = o.user_id and n.enabled)
      or not exists (select 1 from public.user_topics ut
        join public.topics t on t.id = ut.topic_id and t.is_active
        where ut.user_id = o.user_id)
      or exists (select 1 from public.daily_assignments a
        where a.user_id = o.user_id and a.completed_at is not null
          and a.assigned_for in (o.local_date, (v_at at time zone
            (select p.timezone from public.profiles p where p.id=o.user_id))::date))
      or exists (select 1 from public.daily_reviews r
        where r.user_id = o.user_id and r.completed_at is not null
          and r.assigned_for in (o.local_date, (v_at at time zone
            (select p.timezone from public.profiles p where p.id=o.user_id))::date))
    );
  with picked as (
    select id from public.daily_reminder_outbox
      where status = 'pending' order by id limit p_limit for update skip locked
  ), claimed as (
    update public.daily_reminder_outbox o
       set status = 'sending', claimed_at = v_at
      from picked where o.id = picked.id
      returning o.id, o.expo_push_token
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'to', expo_push_token)
    order by id), '[]'::jsonb) into v_rows from claimed;
  return v_rows;
end
$$;

create function public.edge_worker_record_reminders(p_results jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_item jsonb;
declare v_status text;
declare v_id bigint;
declare v_user uuid;
declare v_token text;
declare v_count integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' or
     jsonb_array_length(p_results) > 100 then
    raise exception 'Invalid reminder results';
  end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_item) <> 'object' or
       coalesce(v_item->>'status','') not in ('accepted','rejected','unknown') or
       coalesce(v_item->>'id','') !~ '^[0-9]+$' then
      raise exception 'Invalid reminder result item';
    end if;
    v_id := (v_item->>'id')::bigint;
    v_status := v_item->>'status';
    update public.daily_reminder_outbox set status = v_status,
      finished_at = clock_timestamp() where id = v_id and status = 'sending'
      returning user_id, expo_push_token into v_user, v_token;
    if found then
      v_count := v_count + 1;
      if v_status = 'rejected' and v_item->>'error' = 'DeviceNotRegistered' then
        delete from public.device_tokens where user_id = v_user
          and expo_push_token = v_token;
      end if;
    end if;
  end loop;
  return v_count;
end
$$;

create function public.edge_worker_expire_reminders()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.daily_reminder_outbox set status='unknown', finished_at=clock_timestamp()
    where status='sending' and claimed_at < clock_timestamp()-interval '5 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.edge_worker_enqueue_reminders(timestamptz,integer),
  public.edge_worker_claim_reminders(integer,timestamptz),
  public.edge_worker_record_reminders(jsonb),
  public.edge_worker_expire_reminders()
  from public, anon, authenticated;
grant execute on function public.edge_worker_enqueue_reminders(timestamptz,integer),
  public.edge_worker_claim_reminders(integer,timestamptz),
  public.edge_worker_record_reminders(jsonb),
  public.edge_worker_expire_reminders()
  to service_role;

commit;

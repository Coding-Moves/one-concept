-- Queue, send and inspect weekly quiz pushes in bounded, committed steps.
begin;

create function public.edge_worker_enqueue_weekly(
  p_at timestamptz default null, p_window integer default 15,
  p_limit integer default 50
)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(p_at, clock_timestamp());
  v_day date := (v_at at time zone 'UTC')::date;
  v_week date;
  v_user uuid;
  v_payload jsonb;
  v_quiz uuid;
  v_queued uuid;
  v_count integer := 0;
begin
  if p_window is null or p_window not between 1 and 60 or
     p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid weekly enqueue bounds';
  end if;
  v_week := v_day - (extract(isodow from v_day)::integer - 1);
  for v_user in
    select p.id from public.profiles p
      join public.notification_preferences n on n.user_id=p.id
     where n.enabled and n.weekly_quiz_enabled
       and (v_at at time zone p.timezone)::time >= time '09:00'
       and (v_at at time zone p.timezone)::time <
         time '09:00' + make_interval(mins => p_window)
       and exists (select 1 from public.device_tokens d where d.user_id=p.id)
       and (exists (select 1 from public.weekly_quizzes q
              where q.user_id=p.id and q.week_start=v_week)
         or (select count(*) from (
              select c.id from public.daily_assignments a
              join public.concepts c on c.id=a.concept_id
              where a.user_id=p.id and a.completed_at is not null
                and c.status='published'
                and case when jsonb_typeof(c.mcqs)='array'
                  then jsonb_array_length(c.mcqs)=3 else false end
              group by c.id limit 7
            ) available) = 7)
       and not exists (select 1 from public.weekly_quizzes q
         where q.user_id=p.id and q.week_start=v_week
           and (q.notification_queued_at is not null or exists (
             select 1 from public.weekly_quiz_attempts a where a.quiz_id=q.id)))
     order by p.id limit p_limit for update of p skip locked
  loop
    -- Reuse the API's immutable seven-question snapshot and profile lock.
    v_payload := public.edge_api_weekly_quiz(v_user);
    if v_payload->>'available' = 'true' then
      v_quiz := (v_payload->>'quiz_id')::uuid;
      update public.weekly_quizzes set notification_queued_at=v_at
        where id=v_quiz and week_start=v_week
          and notification_queued_at is null
          and not exists (select 1 from public.weekly_quiz_attempts a
            where a.quiz_id=v_quiz)
        returning id into v_queued;
      if v_queued is not null then
        insert into public.weekly_quiz_notifications(
          quiz_id,expo_push_token,next_attempt_at,updated_at)
          select v_quiz,d.expo_push_token,v_at,v_at
            from public.device_tokens d where d.user_id=v_user
          on conflict do nothing;
        v_count := v_count + 1;
      end if;
      v_queued := null;
    end if;
  end loop;
  return v_count;
end
$$;

create function public.edge_worker_claim_weekly(
  p_at timestamptz default null, p_limit integer default 100
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(p_at, clock_timestamp());
  v_day date := (v_at at time zone 'UTC')::date;
  v_week date;
  v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid weekly batch limit';
  end if;
  v_week := v_day - (extract(isodow from v_day)::integer - 1);
  update public.weekly_quiz_notifications w set status='skipped',updated_at=v_at
    from public.weekly_quizzes q
    join public.notification_preferences n on n.user_id=q.user_id
    where w.quiz_id=q.id and w.status in ('pending','retry')
      and (q.week_start<>v_week or not n.enabled or not n.weekly_quiz_enabled
        or exists(select 1 from public.weekly_quiz_attempts a where a.quiz_id=q.id)
        or not exists(select 1 from public.device_tokens d
          where d.user_id=q.user_id and d.expo_push_token=w.expo_push_token));
  with due as (
    select w.id from public.weekly_quiz_notifications w
      join public.weekly_quizzes q on q.id=w.quiz_id
      join public.profiles p on p.id=q.user_id
      join public.notification_preferences n on n.user_id=q.user_id
     where w.status in ('pending','retry') and w.attempts<3
       and w.next_attempt_at<=v_at and q.week_start=v_week
       and n.enabled and n.weekly_quiz_enabled
       and not exists(select 1 from public.weekly_quiz_attempts a where a.quiz_id=q.id)
       and exists(select 1 from public.device_tokens d
         where d.user_id=q.user_id and d.expo_push_token=w.expo_push_token)
       and (v_at at time zone p.timezone)::time >= time '09:00'
       and (v_at at time zone p.timezone)::time < time '20:00'
     order by w.next_attempt_at,w.id limit p_limit for update of w skip locked
  ), claimed as (
    update public.weekly_quiz_notifications w
       set status='sending',attempts=attempts+1,updated_at=v_at
      from due where w.id=due.id
      returning w.id,w.quiz_id,w.expo_push_token,w.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'quiz_id',quiz_id,'to',expo_push_token,'attempts',attempts)
    order by id),'[]'::jsonb) into v_rows from claimed;
  return v_rows;
end
$$;

create function public.edge_worker_record_weekly(
  p_results jsonb, p_at timestamptz default null
)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(p_at,clock_timestamp());
  v_item jsonb;
  v_id uuid;
  v_state text;
  v_ticket text;
  v_attempts integer;
  v_quiz uuid;
  v_token text;
  v_count integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results)<>'array' or
     jsonb_array_length(p_results)>100 then
    raise exception 'Invalid weekly results';
  end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    v_state := v_item->>'status';
    if jsonb_typeof(v_item)<>'object' or
       coalesce(v_state,'') not in ('accepted','retry','failed','unknown') or
       coalesce(v_item->>'id','') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid weekly result item';
    end if;
    v_id := (v_item->>'id')::uuid;
    v_ticket := v_item->>'ticket';
    if v_state='accepted' and (v_ticket is null or
       length(v_ticket) not between 1 and 256 or v_ticket ~ '[^!-~]') then
      v_state := 'unknown';
      v_ticket := null;
    end if;
    update public.weekly_quiz_notifications w set
      status=case when v_state='retry' and w.attempts>=3 then 'failed'
        else v_state end,
      ticket_id=case when v_state='accepted' then v_ticket else null end,
      next_attempt_at=case when v_state='accepted' then v_at+interval '15 minutes'
        when v_state='retry' then v_at + make_interval(
          mins => 15 * (1 << greatest(0,w.attempts-1)))
        else 'infinity'::timestamptz end,
      updated_at=v_at
      where w.id=v_id and w.status='sending'
      returning quiz_id,expo_push_token,attempts into v_quiz,v_token,v_attempts;
    if found then
      v_count := v_count+1;
      if v_state='failed' and v_item->>'error'='DeviceNotRegistered' then
        delete from public.device_tokens d using public.weekly_quizzes q
          where q.id=v_quiz and d.user_id=q.user_id
            and d.expo_push_token=v_token;
      end if;
    end if;
  end loop;
  return v_count;
end
$$;

create function public.edge_worker_claim_weekly_receipts(
  p_at timestamptz default null, p_limit integer default 100
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_at timestamptz := coalesce(p_at,clock_timestamp());
declare v_rows jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid receipt batch limit';
  end if;
  with due as (
    select id from public.weekly_quiz_notifications
      where status='accepted' and ticket_id is not null
        and next_attempt_at<=v_at
      order by next_attempt_at,id limit p_limit for update skip locked
  ), claimed as (
    update public.weekly_quiz_notifications w
      set next_attempt_at=v_at+interval '15 minutes'
      from due where w.id=due.id
      returning w.id,w.ticket_id,w.updated_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'ticket',ticket_id,'accepted_at',updated_at)
    order by id),'[]'::jsonb) into v_rows from claimed;
  return v_rows;
end
$$;

create function public.edge_worker_record_weekly_receipts(
  p_results jsonb, p_at timestamptz default null
)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_at timestamptz := coalesce(p_at,clock_timestamp());
  v_item jsonb;
  v_id uuid;
  v_state text;
  v_quiz uuid;
  v_token text;
  v_count integer := 0;
begin
  if p_results is null or jsonb_typeof(p_results)<>'array' or
     jsonb_array_length(p_results)>100 then
    raise exception 'Invalid weekly receipt results';
  end if;
  for v_item in select value from jsonb_array_elements(p_results) loop
    v_state := v_item->>'status';
    if jsonb_typeof(v_item)<>'object' or
      coalesce(v_state,'') not in ('ok','rate_limited','device_gone','failed','missing') or
      coalesce(v_item->>'id','') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
      length(coalesce(v_item->>'ticket','')) not between 1 and 256 or
      coalesce(v_item->>'ticket','') ~ '[^!-~]' then
      raise exception 'Invalid weekly receipt item';
    end if;
    v_id := (v_item->>'id')::uuid;
    update public.weekly_quiz_notifications w set
      status=case when v_state='rate_limited' and w.attempts<3 then 'retry'
        when v_state='rate_limited' then 'failed'
        when v_state='device_gone' or v_state='failed' then 'failed'
        when v_state='missing' and v_at-w.updated_at>interval '24 hours' then 'unknown'
        else 'accepted' end,
      next_attempt_at=case when v_state='rate_limited' and w.attempts<3 then
          v_at+make_interval(mins => 15 * (1 << greatest(0,w.attempts-1)))
        when v_state='missing' and v_at-w.updated_at<=interval '24 hours'
          then v_at+interval '15 minutes'
        else 'infinity'::timestamptz end,
      updated_at=case when v_state='missing' or v_state='ok' then w.updated_at
        else v_at end
      where w.id=v_id and w.status='accepted'
        and w.ticket_id=v_item->>'ticket'
      returning quiz_id,expo_push_token into v_quiz,v_token;
    if found then
      v_count := v_count+1;
      if v_state='device_gone' then
        delete from public.device_tokens d using public.weekly_quizzes q
          where q.id=v_quiz and d.user_id=q.user_id
            and d.expo_push_token=v_token;
      end if;
    end if;
  end loop;
  return v_count;
end
$$;

create function public.edge_worker_expire_weekly_sends()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.weekly_quiz_notifications set status='unknown',updated_at=clock_timestamp()
    where status='sending' and updated_at<clock_timestamp()-interval '5 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.edge_worker_enqueue_weekly(timestamptz,integer,integer),
  public.edge_worker_claim_weekly(timestamptz,integer),
  public.edge_worker_record_weekly(jsonb,timestamptz),
  public.edge_worker_claim_weekly_receipts(timestamptz,integer),
  public.edge_worker_record_weekly_receipts(jsonb,timestamptz),
  public.edge_worker_expire_weekly_sends()
  from public, anon, authenticated;
grant execute on function public.edge_worker_enqueue_weekly(timestamptz,integer,integer),
  public.edge_worker_claim_weekly(timestamptz,integer),
  public.edge_worker_record_weekly(jsonb,timestamptz),
  public.edge_worker_claim_weekly_receipts(timestamptz,integer),
  public.edge_worker_record_weekly_receipts(jsonb,timestamptz),
  public.edge_worker_expire_weekly_sends()
  to service_role;

commit;

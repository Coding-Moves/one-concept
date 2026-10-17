-- Owner overview uses UTC windows and the same learner exclusion as FastAPI.
begin;

create function public.edge_api_editorial_owner_window(p_start date, p_end date)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date;
  v_start date;
  v_end date;
  v_stop timestamptz;
begin
  v_today := (v_now at time zone 'UTC')::date;
  v_end := coalesce(p_end,v_today);
  if v_end < date '0001-01-30' then
    return jsonb_build_object('error','invalid_end');
  end if;
  v_start := coalesce(p_start,v_end-29);
  if v_end>v_today or v_start>v_end or v_end-v_start>89 then
    return jsonb_build_object('error','invalid_range');
  end if;
  v_stop := least((v_end+1)::timestamp at time zone 'UTC',v_now);
  return jsonb_build_object(
    'start',public.edge_api_editorial_utc_iso(v_start::timestamp at time zone 'UTC'),
    'stop',public.edge_api_editorial_utc_iso(v_stop),
    'end',v_end,'observed_at',public.edge_api_editorial_utc_iso(v_now));
end
$$;

create function public.edge_api_editorial_owner_overview(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_start date, p_end date
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_window jsonb;
  v_start timestamptz;
  v_stop timestamptz;
  v_end date;
  v_month timestamptz;
  v_week timestamptz;
  v_day timestamptz;
  v_metrics jsonb;
  v_trend jsonb;
  v_team jsonb;
  v_queue jsonb;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  v_window := public.edge_api_editorial_owner_window(p_start,p_end);
  if v_window ? 'error' then return v_window; end if;
  perform pg_catalog.set_config('statement_timeout','5s',true);
  perform pg_catalog.set_config('TimeZone','UTC',true);
  v_start := (v_window->>'start')::timestamptz;
  v_stop := (v_window->>'stop')::timestamptz;
  v_end := (v_window->>'end')::date;
  v_month := (v_end-29)::timestamp at time zone 'UTC';
  v_week := (v_end-6)::timestamp at time zone 'UTC';
  v_day := v_end::timestamp at time zone 'UTC';
  with learners as (
    select p.id,p.created_at from public.profiles p where p.created_at<v_stop and (
      not exists(select 1 from public.editorial_memberships m where m.user_id=p.id)
      or exists(select 1 from public.user_concept_completions x
        where x.user_id=p.id and x.completed_at<v_stop)
      or exists(select 1 from public.daily_reviews x
        where x.user_id=p.id and x.completed_at<v_stop))
  ), activity as (
    select user_id,completed_at,'lesson' as kind
      from public.user_concept_completions
      where completed_at>=least(v_start,v_month) and completed_at<v_stop
    union all
    select user_id,completed_at,'review' from public.daily_reviews
      where completed_at>=least(v_start,v_month) and completed_at<v_stop
  ), valid as (select a.* from activity a join learners l on l.id=a.user_id)
  select jsonb_build_object(
    'registered',(select count(*) from learners),
    'new_registrations',(select count(*) from learners where created_at>=v_start),
    'active_day',count(distinct user_id) filter(where completed_at>=v_day),
    'active_week',count(distinct user_id) filter(where completed_at>=v_week),
    'active_month',count(distinct user_id) filter(where completed_at>=v_month),
    'lessons',count(*) filter(where kind='lesson' and completed_at>=v_start),
    'reviews',count(*) filter(where kind='review' and completed_at>=v_start))
    into v_metrics from valid;
  with learners as (
    select p.id,p.created_at from public.profiles p where p.created_at<v_stop and (
      not exists(select 1 from public.editorial_memberships m where m.user_id=p.id)
      or exists(select 1 from public.user_concept_completions x
        where x.user_id=p.id and x.completed_at<v_stop)
      or exists(select 1 from public.daily_reviews x
        where x.user_id=p.id and x.completed_at<v_stop))
  ), activity as (
    select user_id,completed_at,'lesson' as kind
      from public.user_concept_completions where completed_at>=v_start and completed_at<v_stop
    union all
    select user_id,completed_at,'review' from public.daily_reviews
      where completed_at>=v_start and completed_at<v_stop
  ), daily as (
    select (completed_at at time zone 'UTC')::date as day,
      count(*) filter(where kind='lesson') as lessons,
      count(*) filter(where kind='review') as reviews,
      count(distinct user_id) as active
    from activity join learners on learners.id=activity.user_id group by 1
  ), days as (
    select d::date as day,coalesce(lessons,0) as lessons,
      coalesce(reviews,0) as reviews,coalesce(active,0) as active
    from generate_series(v_start,v_end::timestamp at time zone 'UTC',interval '1 day') d
    left join daily on daily.day=d::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'day',day,'lessons',lessons,'reviews',reviews,'active',active)
    order by day),'[]'::jsonb) into v_trend from days;
  select jsonb_build_object(
    'invited',count(*) filter(where status='active' and approved_name is null),
    'active',count(*) filter(where status='active' and approved_name is not null),
    'revoked',count(*) filter(where status='revoked')) into v_team
    from public.editorial_memberships;
  select jsonb_build_object(
    'pending',count(*),
    'assigned',count(*) filter(where assigned_to is not null),
    'overdue',count(*) filter(where review_due_at<statement_timestamp()))
    into v_queue from public.concept_revisions r join public.concepts c on c.id=r.concept_id
    where r.status in ('draft','pending_review','changes_requested','validation_failed','approved')
      and r.base_version=c.content_version and c.status<>'archived';
  return v_window || jsonb_build_object(
    'metrics',v_metrics,'trend',v_trend,'team',v_team,'queue',v_queue);
end
$$;

revoke all on function public.edge_api_editorial_owner_window(date,date)
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_owner_overview(
  uuid,uuid,text,date,date) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_window(date,date)
  to service_role;
grant execute on function public.edge_api_editorial_owner_overview(
  uuid,uuid,text,date,date) to service_role;

commit;

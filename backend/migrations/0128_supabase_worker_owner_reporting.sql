-- Keep owner health and event history useful after scheduled work leaves Railway.
-- The existing reporting API keeps showing Railway until a Supabase job is enabled.
begin;

create index edge_worker_runs_observed_at on public.edge_worker_runs
  ((coalesce(finished_at,started_at,queued_at)) desc,id desc);

create or replace function public.edge_api_editorial_owner_operations(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_environment text, p_telemetry_enabled boolean, p_generation_enabled boolean,
  p_future_refill_enabled boolean, p_legacy_enrichment_enabled boolean,
  p_auto_correction_enabled boolean, p_email_enabled boolean,
  p_generation_daily_cap integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_now timestamptz := clock_timestamp();
  v_workers jsonb := '[]'::jsonb;
  v_service text;
  v_stale_minutes integer;
  v_event record;
  v_job record;
  v_run record;
  v_has_run boolean;
  v_observation jsonb;
  v_status text;
  v_budget bigint;
  v_jobs jsonb;
  v_emails jsonb;
begin
  if p_environment is null or length(p_environment)>40
    or p_telemetry_enabled is null or p_generation_enabled is null
    or p_future_refill_enabled is null or p_legacy_enrichment_enabled is null
    or p_auto_correction_enabled is null or p_email_enabled is null
    or p_generation_daily_cap is null or p_generation_daily_cap<0 then
    return jsonb_build_object('error','invalid_config');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.set_config('statement_timeout','5s',true);
  perform pg_catalog.set_config('TimeZone','UTC',true);

  if exists (select 1 from public.edge_worker_jobs where enabled) then
    for v_job in select name,enabled from public.edge_worker_jobs order by name loop
      v_stale_minutes := case v_job.name
        when 'editorial_email' then 30
        when 'content_pool' then 20
        when 'prefetch' then 20
        when 'editorial_generation' then 8
        when 'legacy_enrichment' then 8
        else 5 end;
      select status,queued_at,started_at,finished_at,id into v_run
        from public.edge_worker_runs where job=v_job.name
        order by scheduled_for desc limit 1;
      v_has_run := found;
      if v_has_run then
        v_observation := jsonb_build_object(
          'observed_at',public.edge_api_editorial_utc_iso(
            coalesce(v_run.finished_at,v_run.started_at,v_run.queued_at)),
          'code',case when v_run.status='succeeded' then 'completed'
            when v_run.status in ('failed','timed_out') then 'failed'
            else 'started' end,
          'correlation_id',v_run.id);
      else
        v_observation := null;
      end if;
      v_status := case
        when not v_job.enabled then 'disabled'
        when not v_has_run then 'unavailable'
        when v_run.status in ('failed','timed_out') then 'failed'
        when v_run.status in ('queued','running')
          and coalesce(v_run.started_at,v_run.queued_at)<v_now-interval '5 minutes'
          then 'stale'
        when v_run.status in ('queued','running') then 'started'
        when v_run.finished_at<v_now-make_interval(mins=>v_stale_minutes)
          then 'stale'
        else 'completed' end;
      v_workers := v_workers || jsonb_build_array(jsonb_build_object(
        'service',v_job.name,'status',v_status,'observation',v_observation,
        'stale_after_minutes',v_stale_minutes));
    end loop;
  else
    for v_service,v_stale_minutes in
      select * from (values ('reminders',45),('pool_topup',2160)) as services(service,minutes)
    loop
      select observed_at,code,correlation_id into v_event
        from public.owner_operation_events
        where service=v_service and observed_at>=v_now-interval '30 days'
        order by observed_at desc,id desc limit 1;
      if found then
        v_observation := jsonb_build_object(
          'observed_at',public.edge_api_editorial_utc_iso(v_event.observed_at),
          'code',v_event.code,'correlation_id',v_event.correlation_id);
        v_status := case when extract(epoch from (v_now-v_event.observed_at))/60 >
          case when v_event.code='started' then 30 else v_stale_minutes end
          then 'stale' else v_event.code end;
      else
        v_observation := null;
        v_status := 'unavailable';
      end if;
      v_workers := v_workers || jsonb_build_array(jsonb_build_object(
        'service',v_service,'status',v_status,'observation',v_observation,
        'stale_after_minutes',v_stale_minutes));
    end loop;
  end if;

  select coalesce((select calls_used from public.generation_daily_usage
    where budget_day=(statement_timestamp() at time zone 'America/Los_Angeles')::date),0)
    into v_budget;
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'),
    'generating',count(*) filter(where status='generating'),
    'failed',count(*) filter(where status='failed'),
    'stale',count(*) filter(where status='generating' and claimed_at<now()-interval '30 minutes'))
    into v_jobs from public.editorial_generation_jobs;
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'),
    'sending',count(*) filter(where status='sending'),
    'failed',count(*) filter(where status='failed'),
    'sent_last_day',count(*) filter(where status='sent' and sent_at>=now()-interval '24 hours'))
    into v_emails from public.editorial_email_batches;
  return jsonb_build_object(
    'observed_at',public.edge_api_editorial_utc_iso(v_now),
    'environment',p_environment,'api','reachable','database','reachable',
    'telemetry_enabled',p_telemetry_enabled,
    'generation_enabled',p_generation_enabled,
    'future_refill_enabled',p_generation_enabled and p_future_refill_enabled,
    'legacy_enrichment_enabled',p_generation_enabled and p_legacy_enrichment_enabled,
    'editorial_auto_correction_enabled',p_generation_enabled and p_auto_correction_enabled,
    'email_enabled',p_email_enabled,
    'workers',v_workers,'revision_jobs',v_jobs,'emails',v_emails,
    'budget',jsonb_build_object(
      'reserved_calls',v_budget,'configured_cap',p_generation_daily_cap,
      'timezone','America/Los_Angeles'),
    'unavailable',jsonb_build_array(
      'Host CPU and memory','Provider delivery/inbox logs',
      'Historical uptime and request latency'));
end
$$;

create or replace function public.edge_api_editorial_owner_events(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_start date, p_end date, p_source text, p_severity text,
  p_search text, p_correlation uuid,
  p_before_time timestamptz, p_before_key text, p_limit integer
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
  v_items jsonb := '[]'::jsonb;
  v_next text;
  v_count integer := 0;
  v_has_more boolean := false;
  v_row record;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_limit is null or p_limit<1 or p_limit>50 or length(p_search)>80
    or (p_source is not null and p_source not in
      ('api','reminders','pool_topup','review','workflow','account'))
    or (p_severity is not null and p_severity not in ('info','error')) then
    return jsonb_build_object('error','invalid_page');
  end if;
  if (p_before_time is null) <> (p_before_key is null)
    or length(p_before_key)>80 then
    return jsonb_build_object('error','invalid_cursor');
  end if;
  v_window := public.edge_api_editorial_owner_window(p_start,p_end);
  if v_window ? 'error' then return v_window; end if;
  perform pg_catalog.set_config('statement_timeout','5s',true);
  perform pg_catalog.set_config('TimeZone','UTC',true);
  v_start := (v_window->>'start')::timestamptz;
  v_stop := (v_window->>'stop')::timestamptz;
  for v_row in
    with events as (
      select 'operation:'||id::text as key,observed_at,
        service as source,code as action,severity,correlation_id
        from public.owner_operation_events
        where observed_at>=v_start and observed_at<v_stop
          and observed_at>=now()-interval '30 days'
      union all
      select 'edge:'||r.id::text,
        coalesce(r.finished_at,r.started_at,r.queued_at),
        case when r.job in ('daily_reminders','weekly_quiz','editorial_email')
          then 'reminders' else 'pool_topup' end,
        r.job||':'||r.status,
        case when r.status in ('failed','timed_out') then 'error' else 'info' end,
        r.id
        from public.edge_worker_runs r
        where coalesce(r.finished_at,r.started_at,r.queued_at)>=v_start
          and coalesce(r.finished_at,r.started_at,r.queued_at)<v_stop
          and r.queued_at>=now()-interval '30 days'
      union all
      select 'review:'||id::text,created_at,'review',action,
        case when action='validation_failed' then 'error' else 'info' end,id
        from public.editorial_revision_events
        where created_at>=v_start and created_at<v_stop
      union all
      select 'workflow:'||id::text,created_at,'workflow',action,'info',id
        from public.editorial_workflow_events
        where created_at>=v_start and created_at<v_stop
      union all
      select 'account:'||id::text,created_at,'account',action,'info',null::uuid
        from public.editorial_account_events
        where created_at>=v_start and created_at<v_stop
    )
    select * from events
      where observed_at>=v_start and observed_at<v_stop
        and (p_source is null or source=p_source)
        and (p_severity is null or severity=p_severity)
        and (p_correlation is null or correlation_id=p_correlation)
        and (p_search is null or strpos(lower(source||' '||action),lower(p_search))>0)
        and (p_before_time is null or (observed_at,key)<(p_before_time,p_before_key))
      order by observed_at desc,key desc limit p_limit+1
  loop
    if v_count>=p_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'key',v_row.key,
      'observed_at',public.edge_api_editorial_utc_iso(v_row.observed_at),
      'source',v_row.source,'action',v_row.action,
      'severity',v_row.severity,'correlation_id',v_row.correlation_id));
    v_count := v_count+1;
    v_next := public.edge_api_editorial_utc_iso(v_row.observed_at)||'~'||v_row.key;
  end loop;
  return jsonb_build_object(
    'items',v_items,'next_cursor',case when v_has_more then v_next else null end,
    'observed_at',v_window->>'observed_at');
end
$$;

-- Preserve the service-only execute grants on the replaced functions.
revoke all on function public.edge_api_editorial_owner_operations(
  uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_operations(
  uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer
) to service_role;
revoke all on function public.edge_api_editorial_owner_events(
  uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_events(
  uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)
  to service_role;

commit;

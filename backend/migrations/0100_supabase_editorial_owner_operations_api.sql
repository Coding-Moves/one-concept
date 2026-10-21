-- Owner operations expose bounded aggregate health, never worker payloads.
begin;

create function public.edge_api_editorial_owner_operations(
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

revoke all on function public.edge_api_editorial_owner_operations(
  uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_operations(
  uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer
) to service_role;

commit;

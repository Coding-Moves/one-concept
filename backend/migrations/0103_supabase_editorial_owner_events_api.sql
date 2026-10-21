-- Owner event feed exposes allowlisted metadata only, with exact UTC cursors.
begin;

create function public.edge_api_editorial_owner_events(
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
      where (p_source is null or source=p_source)
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

revoke all on function public.edge_api_editorial_owner_events(
  uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_events(
  uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)
  to service_role;

commit;

-- Expose only the existing generation-job allowlist and its exact version token.
begin;

create function public.edge_api_editorial_utc_iso(p_value timestamptz)
returns text
language sql stable strict
set search_path = ''
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') ||
    case when extract(microseconds from p_value)::integer % 1000000 = 0
      then '' else '.' || to_char(p_value at time zone 'UTC', 'US') end || '+00:00'
$$;

create function public.edge_api_editorial_job_public(p_job public.editorial_generation_jobs)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_stamp text;
  v_payload text;
begin
  v_stamp := public.edge_api_editorial_utc_iso(p_job.updated_at);
  -- Python json.dumps(sort_keys=True, separators=(',', ':')) over the four
  -- version fields, with FastAPI's UTC datetime encoding.
  v_payload := format('{"attempts":%s,"id":%s,"status":%s,"updated_at":%s}',
    p_job.attempts, to_jsonb(p_job.id)::text, to_jsonb(p_job.status)::text,
    to_jsonb(v_stamp)::text);
  return jsonb_build_object(
    'id',p_job.id,'source_revision_id',p_job.source_revision_id,
    'concept_id',p_job.concept_id,'topic_id',p_job.topic_id,
    'feedback_event_id',p_job.feedback_event_id,
    'request_event_id',p_job.request_event_id,'status',p_job.status,
    'attempts',p_job.attempts,
    'available_at',public.edge_api_editorial_utc_iso(p_job.available_at),
    'result_revision_id',p_job.result_revision_id,'failure_code',p_job.failure_code,
    'created_at',public.edge_api_editorial_utc_iso(p_job.created_at),
    'updated_at',v_stamp,
    'token',encode(pg_catalog.sha256(convert_to(v_payload,'UTF8')),'hex')
  );
end
$$;

create function public.edge_api_editorial_generation_jobs(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_status text, p_topic_id uuid, p_concept_id uuid,
  p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_status is not null and p_status not in (
       'pending','generating','failed','ready_for_review','cancelled','superseded')) then
    return jsonb_build_object('error','invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select j.id,public.edge_api_editorial_job_public(j) as item
    from public.editorial_generation_jobs j
    where (p_status is null or j.status=p_status)
      and (p_topic_id is null or j.topic_id=p_topic_id)
      and (p_concept_id is null or j.concept_id=p_concept_id)
      and (p_cursor is null or j.id>p_cursor)
    order by j.id limit p_limit+1
  ), numbered as (
    select page.*,row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position<=p_limit), '[]'::jsonb),
         (select id from numbered where position=p_limit
           and exists(select 1 from numbered where position>p_limit))
    into v_items,v_next from numbered;
  return jsonb_build_object('items',v_items,'next_cursor',v_next);
end
$$;

create function public.edge_api_editorial_generation_job(
  p_user_id uuid, p_session_id uuid, p_aal text, p_job_id uuid
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_job public.editorial_generation_jobs%rowtype;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_job from public.editorial_generation_jobs where id=p_job_id;
  if not found then return jsonb_build_object('error','job_not_found'); end if;
  return public.edge_api_editorial_job_public(v_job);
end
$$;

revoke all on function public.edge_api_editorial_utc_iso(timestamptz)
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_job_public(public.editorial_generation_jobs)
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_generation_jobs(uuid,uuid,text,text,uuid,uuid,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_generation_job(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_utc_iso(timestamptz)
  to service_role;
grant execute on function public.edge_api_editorial_job_public(public.editorial_generation_jobs)
  to service_role;
grant execute on function public.edge_api_editorial_generation_jobs(uuid,uuid,text,text,uuid,uuid,uuid,integer)
  to service_role;
grant execute on function public.edge_api_editorial_generation_job(uuid,uuid,text,uuid)
  to service_role;

commit;

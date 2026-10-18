-- Reviewer batch summaries expose the same fields and version token as FastAPI.
begin;

create function public.edge_api_editorial_legacy_batch_public(
  p_batch public.editorial_legacy_batches
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_started text;
  v_finished text;
  v_payload text;
  v_counts jsonb;
begin
  v_started := public.edge_api_editorial_utc_iso(p_batch.started_at);
  v_finished := public.edge_api_editorial_utc_iso(p_batch.finished_at);
  -- The token uses Python's sorted, compact JSON encoding of the six version fields.
  v_payload := format(
    '{"discovered_count":%s,"finished_at":%s,"id":%s,"quota_limit":%s,"started_at":%s,"status":%s}',
    p_batch.discovered_count, coalesce(to_jsonb(v_finished)::text,'null'),
    to_jsonb(p_batch.id)::text, p_batch.quota_limit,
    coalesce(to_jsonb(v_started)::text,'null'), to_jsonb(p_batch.status)::text);
  select coalesce(jsonb_object_agg(s.status,s.total),'{}'::jsonb) into v_counts
  from (
    select case when e.status='ready_for_review' and r.status='published'
        then 'published' else e.status end as status, count(*)::integer as total
    from public.editorial_legacy_batch_entries e
    left join public.concept_revisions r on r.id=e.result_revision_id
    where e.batch_id=p_batch.id group by 1
  ) s;
  return jsonb_build_object(
    'id',p_batch.id,'topic_id',p_batch.topic_id,'name',p_batch.name,
    'model',p_batch.model,'prompt_version',p_batch.prompt_version,
    'status',p_batch.status,'discovered_count',p_batch.discovered_count,
    'quota_limit',p_batch.quota_limit,
    'created_at',public.edge_api_editorial_utc_iso(p_batch.created_at),
    'started_at',v_started,'finished_at',v_finished,
    'token',encode(pg_catalog.sha256(convert_to(v_payload,'UTF8')),'hex'),
    'counts',v_counts);
end
$$;

create function public.edge_api_editorial_legacy_batches(
  p_user_id uuid, p_session_id uuid, p_aal text, p_topic_id uuid
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  select coalesce(jsonb_agg(public.edge_api_editorial_legacy_batch_public(b)
    order by b.created_at desc),'[]'::jsonb) into v_items
  from public.editorial_legacy_batches b
  where p_topic_id is null or b.topic_id=p_topic_id;
  return jsonb_build_object('items',v_items);
end
$$;

revoke all on function public.edge_api_editorial_legacy_batch_public(
  public.editorial_legacy_batches) from public, anon, authenticated;
revoke all on function public.edge_api_editorial_legacy_batches(
  uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_legacy_batch_public(
  public.editorial_legacy_batches) to service_role;
grant execute on function public.edge_api_editorial_legacy_batches(
  uuid,uuid,text,uuid) to service_role;

commit;

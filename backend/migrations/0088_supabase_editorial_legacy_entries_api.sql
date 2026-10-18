-- A reviewer may inspect the bounded set of entries in one enrichment batch.
begin;

create function public.edge_api_editorial_legacy_entries(
  p_user_id uuid, p_session_id uuid, p_aal text, p_batch_id uuid
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
    p_user_id, p_session_id, p_aal, 'review');
  if v_actor ? 'error' then return v_actor; end if;
  if p_batch_id is null or not exists(
    select 1 from public.editorial_legacy_batches where id = p_batch_id
  ) then
    return jsonb_build_object('error', 'batch_not_found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'concept_id', e.concept_id, 'title', c.title,
    'base_version', e.base_version, 'attempts', e.attempts,
    'status', case when e.status = 'ready_for_review' and r.status = 'published'
      then 'published' else e.status end,
    'result_revision_id', e.result_revision_id, 'failure_code', e.failure_code
  ) order by e.created_at, e.id), '[]'::jsonb) into v_items
  from public.editorial_legacy_batch_entries e
  join public.concepts c on c.id = e.concept_id
  left join public.concept_revisions r on r.id = e.result_revision_id
  where e.batch_id = p_batch_id;
  return jsonb_build_object('items', v_items);
end
$$;

revoke all on function public.edge_api_editorial_legacy_entries(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_legacy_entries(uuid,uuid,text,uuid)
  to service_role;

commit;

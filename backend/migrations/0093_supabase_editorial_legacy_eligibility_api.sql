-- Eligibility is an authorized aggregate; the source lesson bodies stay private.
begin;

create function public.edge_api_editorial_legacy_eligibility(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_topic_id uuid, p_configured boolean
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_count bigint;
  v_active_batch uuid;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  if not exists(select 1 from public.topics where id=p_topic_id and is_active) then
    return jsonb_build_object('error','active_topic_not_found');
  end if;
  select count(*) into v_count
    from public.concepts c join public.subtopics s on s.id=c.subtopic_id
   where c.topic_id=p_topic_id and c.status='published' and s.is_active
     and (not exists(select 1 from public.editorial_publications p
            where p.concept_id=c.id and p.content_version=c.content_version)
       or length(btrim(coalesce(c.curriculum->>'objective','')))=0
       or c.curriculum->'difficulty' is null
       or case when jsonb_typeof(c.curriculum->'references')='array'
          then jsonb_array_length(c.curriculum->'references')=0 else true end
       or length(btrim(coalesce(c.flashcard->>'front','')))=0
       or length(btrim(coalesce(c.flashcard->>'back','')))=0
       or case when jsonb_typeof(c.mcqs)='array'
          then jsonb_array_length(c.mcqs)<>3 else true end)
     and not exists(select 1 from public.concept_revisions r
       where r.concept_id=c.id and r.status in
         ('draft','generating','validation_failed','pending_review',
          'changes_requested','approved'))
     and not exists(select 1 from public.editorial_legacy_batch_entries e
       where e.concept_id=c.id and e.status='ready_for_review');
  select id into v_active_batch from public.editorial_legacy_batches
   where status in ('queued','running','paused') limit 1;
  return jsonb_build_object('eligible_count',v_count,
    'active_batch_id',v_active_batch,'configured',coalesce(p_configured,false));
end
$$;

revoke all on function public.edge_api_editorial_legacy_eligibility(
  uuid,uuid,text,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_legacy_eligibility(
  uuid,uuid,text,uuid,boolean
) to service_role;

commit;

-- Private concept preview source. The Edge handler emits only the existing
-- public read model; this RPC alone may read catalog snapshots and provenance.
begin;

create function public.edge_api_editorial_concept_detail_source(
  p_user_id uuid, p_session_id uuid, p_aal text, p_concept_id uuid
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_result jsonb;
begin
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id,p_session_id,p_aal,array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;
  select jsonb_build_object(
    'id',c.id,'slug',c.slug,'status',c.status,
    'title',c.title,'summary',c.summary,'example',c.example,
    'curriculum',c.curriculum,'flashcard',c.flashcard,'mcqs',c.mcqs,
    'model',c.model,'prompt_version',c.prompt_version,
    'content_version',c.content_version,
    'subtopic_slug',s.slug,'topic_active',t.is_active,
    'subtopic_active',s.is_active,
    'snapshot',to_jsonb(c)-array['created_at','published_at','status'],
    'legacy_snapshot',(select l.snapshot from public.editorial_legacy_versions l
      where l.concept_id=c.id and l.content_version=c.content_version),
    'provenance',(select jsonb_build_object(
      'reviewer_id',e.actor_id,'registered_name',e.registered_name,
      'reviewed_at',e.created_at,'content_version',p.content_version)
      from public.editorial_publications p
      join public.editorial_revision_events e on e.id=p.approval_id
      where p.concept_id=c.id and p.content_version=c.content_version
        and c.status='published'
        and p.snapshot=to_jsonb(c)-array['created_at','published_at','status']
        and e.action in ('approved','attested') limit 1),
    'duplicate_slug',(select other.slug from public.concepts other
      where other.id<>c.id and other.status='published' and (
        pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(other.title),
          '[^[:alnum:]_]+',' ','g')) =
        pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(c.title),
          '[^[:alnum:]_]+',' ','g'))
        or pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(other.curriculum->>'objective'),'[^[:alnum:]_]+',' ','g')) =
          pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(c.curriculum->>'objective'),'[^[:alnum:]_]+',' ','g')))
      order by other.slug limit 1),
    'unknown_prerequisite',(select prereq.slug from
      jsonb_array_elements_text(case when jsonb_typeof(c.curriculum->'prerequisites')='array'
        then c.curriculum->'prerequisites' else '[]'::jsonb end)
      with ordinality prereq(slug,position)
      where not exists(select 1 from public.concepts known where known.slug=prereq.slug)
        and not exists(select 1 from public.concept_backlog known where known.slug=prereq.slug)
      order by prereq.position limit 1),
    'unpublished_prerequisite',(select prereq.slug from
      jsonb_array_elements_text(case when jsonb_typeof(c.curriculum->'prerequisites')='array'
        then c.curriculum->'prerequisites' else '[]'::jsonb end)
      with ordinality prereq(slug,position)
      where not exists(select 1 from public.concepts required
        join public.topics rt on rt.id=required.topic_id and rt.is_active
        join public.subtopics rs on rs.id=required.subtopic_id and rs.is_active
        where required.slug=prereq.slug and required.status='published')
      order by prereq.position limit 1)
  ) into v_result
    from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=p_concept_id;
  if v_result is null then
    return jsonb_build_object('error','concept_not_found');
  end if;
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_concept_detail_source(
  uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.edge_api_editorial_concept_detail_source(
  uuid,uuid,text,uuid) to service_role;

commit;

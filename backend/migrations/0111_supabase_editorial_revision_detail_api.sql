-- Private source for the versioned editorial revision read model.
begin;

create function public.edge_api_editorial_revision_detail_source(
  p_user_id uuid, p_session_id uuid, p_aal text, p_revision_id uuid
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
    'revision',to_jsonb(r),
    'content_version',c.content_version,
    'concept_status',c.status,
    'topic_active',t.is_active,
    'subtopic_active',s.is_active,
    'subtopic_slug',s.slug,
    'source_snapshot',to_jsonb(c)-array['created_at','published_at','status'],
    'source_body',jsonb_build_object(
      'title',c.title,'summary',c.summary,'example',c.example,
      'curriculum',c.curriculum,'subtopic_slug',s.slug,
      'model',c.model,'prompt_version',c.prompt_version,
      'learning_package',jsonb_build_object('flashcard',c.flashcard,'mcqs',c.mcqs)),
    'base_snapshot',case when r.status in ('published','retired') then
      coalesce(
        (select e.source_snapshot from public.editorial_revision_events e
          where e.revision_id=r.id and e.base_version=r.base_version
            and e.source_snapshot->>'content_version'=r.base_version::text
          order by (e.action='approved') desc,e.created_at,e.id limit 1),
        (select p.snapshot from public.editorial_publications p
          where p.concept_id=r.concept_id and p.content_version=r.base_version),
        (select l.snapshot from public.editorial_legacy_versions l
          where l.concept_id=r.concept_id and l.content_version=r.base_version))
      else null end,
    'approved_by',(select e.registered_name from public.editorial_revision_events e
      where e.revision_id=r.id and e.action='approved' limit 1),
    'unknown_prerequisite',(select prereq.slug from
      jsonb_array_elements_text(case when jsonb_typeof(r.body->'curriculum'->'prerequisites')='array'
        then r.body->'curriculum'->'prerequisites' else '[]'::jsonb end)
      with ordinality prereq(slug,position)
      where not exists(select 1 from public.concepts known where known.slug=prereq.slug)
        and not exists(select 1 from public.concept_backlog known where known.slug=prereq.slug)
      order by prereq.position limit 1),
    'unpublished_prerequisite',(select prereq.slug from
      jsonb_array_elements_text(case when jsonb_typeof(r.body->'curriculum'->'prerequisites')='array'
        then r.body->'curriculum'->'prerequisites' else '[]'::jsonb end)
      with ordinality prereq(slug,position)
      where not exists(select 1 from public.concepts required
        join public.topics rt on rt.id=required.topic_id and rt.is_active
        join public.subtopics rs on rs.id=required.subtopic_id and rs.is_active
        where required.slug=prereq.slug and required.status='published')
      order by prereq.position limit 1),
    'duplicate_slug',(select other.slug from public.concepts other
      where other.id<>c.id and other.status='published' and (
        pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(other.title),
          '[^[:alnum:]_]+',' ','g')) =
        pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(r.body->>'title'),
          '[^[:alnum:]_]+',' ','g'))
        or pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(other.curriculum->>'objective'),'[^[:alnum:]_]+',' ','g')) =
          pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(r.body->'curriculum'->>'objective'),'[^[:alnum:]_]+',' ','g')))
      order by other.slug limit 1)
  ) into v_result
    from public.concept_revisions r
    join public.concepts c on c.id=r.concept_id
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where r.id=p_revision_id;
  if v_result is null then return jsonb_build_object('error','revision_not_found'); end if;
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_revision_detail_source(
  uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.edge_api_editorial_revision_detail_source(
  uuid,uuid,text,uuid) to service_role;

commit;

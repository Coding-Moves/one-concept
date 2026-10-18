-- Stage one complete legacy subject batch under the same account/catalog lock
-- order as FastAPI; never enqueue a partially discovered subject.
begin;

create function public.edge_api_editorial_create_legacy_batch(
  p_user_id uuid, p_session_id uuid, p_aal text, p_topic_id uuid,
  p_request_id uuid, p_note text, p_name text, p_quota_limit integer,
  p_model text, p_configured boolean, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_batch_id uuid;
  v_count integer;
  v_result jsonb;
  v_note text;
begin
  if p_topic_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_name is null or p_name !~ '^[a-z0-9][a-z0-9-]{2,119}$'
    or p_quota_limit is null or p_quota_limit<1 or p_quota_limit>500
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'request_generation');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_receipt from public.editorial_request_receipts
    where actor_id=p_user_id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>p_fingerprint then
      return jsonb_build_object('error','receipt_conflict');
    end if;
    return v_receipt.result;
  end if;
  if not coalesce(p_configured,false) then
    return jsonb_build_object('error','legacy_disabled');
  end if;
  if p_model is null or p_model !~ '^gemini-3' then
    return jsonb_build_object('error','review_conflict','message',
      'Legacy grounding and structured output require a Gemini 3 model');
  end if;
  if exists(select 1 from public.editorial_legacy_batches
    where status in ('queued','running','paused')) then
    return jsonb_build_object('error','review_conflict','message',
      'Finish or cancel the active subject batch before selecting another');
  end if;
  if not exists(select 1 from public.topics
    where id=p_topic_id and is_active for update) then
    return jsonb_build_object('error','review_conflict','message',
      'Choose an active subject');
  end if;
  select count(*)::integer into v_count
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
          ('draft','generating','validation_failed','pending_review','changes_requested','approved'))
      and not exists(select 1 from public.editorial_legacy_batch_entries e
        where e.concept_id=c.id and e.status='ready_for_review');
  if v_count=0 then
    return jsonb_build_object('error','review_conflict','message',
      'This subject has no eligible published lessons to enrich');
  end if;
  if v_count>p_quota_limit then
    return jsonb_build_object('error','review_conflict','message',
      'Quota limit is below this subject’s eligible lesson count');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict','message',
      'Record a substantive note of at least 10 characters');
  end if;
  insert into public.editorial_legacy_batches
    (topic_id,name,requested_by,model,prompt_version,discovered_count,quota_limit)
    values(p_topic_id,p_name,p_user_id,p_model,
      'legacy-complete-card-v5-publication-bounds',v_count,p_quota_limit)
    returning id into v_batch_id;
  insert into public.editorial_legacy_batch_entries
    (batch_id,concept_id,base_version,source_body)
    select v_batch_id,c.id,c.content_version,jsonb_build_object(
      'title',c.title,'summary',c.summary,'example',c.example,
      'curriculum',c.curriculum,'flashcard',c.flashcard,'mcqs',c.mcqs,
      'topic_id',c.topic_id,'subtopic_id',c.subtopic_id,'subtopic_slug',s.slug)
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
          ('draft','generating','validation_failed','pending_review','changes_requested','approved'))
      and not exists(select 1 from public.editorial_legacy_batch_entries e
        where e.concept_id=c.id and e.status='ready_for_review')
    order by c.created_at,c.id;
  insert into public.editorial_workflow_events
    (topic_id,actor_id,registered_name,action,note,details)
    values(p_topic_id,p_user_id,v_actor->>'approved_name',
      'generation_requested',v_note,jsonb_build_object(
        'kind','legacy_enrichment','batch_id',v_batch_id,'eligible',v_count));
  select public.edge_api_editorial_legacy_batch_public(b) into v_result
    from public.editorial_legacy_batches b where id=v_batch_id;
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_create_legacy_batch(
  uuid,uuid,text,uuid,uuid,text,text,integer,text,boolean,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_create_legacy_batch(
  uuid,uuid,text,uuid,uuid,text,text,integer,text,boolean,text)
  to service_role;

commit;

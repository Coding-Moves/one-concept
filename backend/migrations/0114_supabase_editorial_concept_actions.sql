-- Keep editorial actions atomic with the approval evidence and request receipt.
begin;

create function public.edge_api_editorial_quality_valid(p_quality jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_quality)='object'
    and (select count(*) from jsonb_object_keys(p_quality))=9
    and p_quality->'factual_accuracy'='true'::jsonb
    and p_quality->'usefulness'='true'::jsonb
    and p_quality->'clarity'='true'::jsonb
    and p_quality->'topic_subtopic_accuracy'='true'::jsonb
    and p_quality->'example_quality'='true'::jsonb
    and p_quality->'flashcard_quality'='true'::jsonb
    and p_quality->'mcq_quality'='true'::jsonb
    and p_quality->'references_checked'='true'::jsonb
    and p_quality->>'sensitive_topic_handling' in ('not_applicable','reviewed')
$$;

create function public.edge_api_editorial_concept_token(p_concept_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'snapshot',to_jsonb(c)-array['created_at','published_at','status'],
      'status',c.status,'topic_active',t.is_active,
      'subtopic_active',s.is_active,'subtopic_slug',s.slug)),
    'UTF8')),'hex') from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=p_concept_id
$$;

-- Same publication checks used by the FastAPI review gate. A string result is
-- a user-facing conflict; null means the candidate is currently publishable.
create function public.edge_api_editorial_candidate_problem(
  p_concept_id uuid, p_slug text, p_body jsonb
)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_problem text;
  v_prereq text;
begin
  if jsonb_typeof(p_body)<>'object'
    or jsonb_typeof(p_body->'curriculum')<>'object'
    or jsonb_typeof(p_body->'learning_package')<>'object'
    or jsonb_typeof(p_body->'learning_package'->'mcqs')<>'array'
    or jsonb_array_length(p_body->'learning_package'->'mcqs')<>3
    or length(coalesce(p_body->>'title',''))<3
    or length(coalesce(p_body->>'summary',''))<100
    or length(coalesce(p_body->>'example',''))<40 then
    return 'Lesson body is incomplete or invalid';
  end if;
  with recursive walk(slug,route,cycle) as (
    select prereq.value,array[p_slug,prereq.value],prereq.value=p_slug
      from jsonb_array_elements_text(coalesce(
        p_body->'curriculum'->'prerequisites','[]'::jsonb)) prereq(value)
    union all
    select child.value,walk.route||child.value,child.value=any(walk.route)
      from walk
      left join public.concepts known_concept on known_concept.slug=walk.slug
      left join public.concept_backlog known_backlog on known_backlog.slug=walk.slug
      cross join lateral jsonb_array_elements_text(coalesce(
        known_concept.curriculum->'prerequisites',
        known_backlog.curriculum->'prerequisites','[]'::jsonb)) child(value)
      where not walk.cycle and cardinality(walk.route)<1000
  )
  select case when walk.cycle then 'Prerequisite cycle includes '||walk.slug
    when not exists(select 1 from public.concepts c where c.slug=walk.slug)
      and not exists(select 1 from public.concept_backlog b where b.slug=walk.slug)
      then 'Unknown prerequisite '||walk.slug end into v_problem
    from walk where walk.cycle or
      (not exists(select 1 from public.concepts c where c.slug=walk.slug)
        and not exists(select 1 from public.concept_backlog b where b.slug=walk.slug))
    limit 1;
  if v_problem is not null then return v_problem; end if;
  for v_prereq in select value from jsonb_array_elements_text(coalesce(
    p_body->'curriculum'->'prerequisites','[]'::jsonb)) loop
    if not exists(select 1 from public.concepts c
      join public.topics t on t.id=c.topic_id and t.is_active
      join public.subtopics s on s.id=c.subtopic_id and s.is_active
      where c.slug=v_prereq and c.status='published') then
      return 'Publish prerequisite '||v_prereq||
        ' in an active topic and subtopic first';
    end if;
  end loop;
  select other.slug into v_problem from public.concepts other
    where other.id<>p_concept_id and other.status='published' and (
      pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(other.title),
        '[^[:alnum:]_]+',' ','g')) =
      pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(p_body->>'title'),
        '[^[:alnum:]_]+',' ','g'))
      or pg_catalog.btrim(pg_catalog.regexp_replace(
        pg_catalog.lower(other.curriculum->>'objective'),'[^[:alnum:]_]+',' ','g')) =
      pg_catalog.btrim(pg_catalog.regexp_replace(
        pg_catalog.lower(p_body->'curriculum'->>'objective'),'[^[:alnum:]_]+',' ','g')))
    order by other.slug limit 1;
  if v_problem is not null then
    return 'Exact duplicate of '||v_problem||'; resolve overlap before publication';
  end if;
  return null;
end
$$;

create function public.edge_api_editorial_concept_action(
  p_user_id uuid, p_session_id uuid, p_aal text, p_concept_id uuid,
  p_request_id uuid, p_note text, p_expected_token text,
  p_action text, p_quality jsonb, p_body_valid boolean, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_concept public.concepts%rowtype;
  v_topic_active boolean;
  v_subtopic_active boolean;
  v_subtopic_slug text;
  v_snapshot jsonb;
  v_body jsonb;
  v_token text;
  v_note text;
  v_problem text;
  v_event uuid;
  v_result jsonb;
  v_capability text;
begin
  if p_concept_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or p_action is null or p_action not in ('comment','retire','attest')
    or ((p_action='attest') is distinct from (p_quality is not null))
    or (p_quality is not null and not coalesce(
      public.edge_api_editorial_quality_valid(p_quality),false))
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid');
  end if;
  v_capability := case when p_action='comment' then 'review' else 'publish' end;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,v_capability);
  if v_actor ? 'error' then return v_actor; end if;
  if p_action='attest' then
    v_actor := public.edge_api_editorial_authorize(
      p_user_id,p_session_id,p_aal,'approve');
    if v_actor ? 'error' then return v_actor; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,v_capability);
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,v_capability);
  if v_actor ? 'error' then return v_actor; end if;
  if p_action='attest' then
    v_actor := public.edge_api_editorial_authorize(
      p_user_id,p_session_id,p_aal,'approve');
    if v_actor ? 'error' then return v_actor; end if;
  end if;
  select * into v_receipt from public.editorial_request_receipts
    where actor_id=p_user_id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>p_fingerprint then
      return jsonb_build_object('error','receipt_conflict');
    end if;
    return v_receipt.result;
  end if;
  select c.* into v_concept from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=p_concept_id for update of c,t,s;
  if not found then return jsonb_build_object('error','concept_not_found'); end if;
  select t.is_active,s.is_active,s.slug into
    v_topic_active,v_subtopic_active,v_subtopic_slug
    from public.topics t join public.subtopics s on s.topic_id=t.id
    where s.id=v_concept.subtopic_id;
  v_snapshot := to_jsonb(v_concept)-array['created_at','published_at','status'];
  v_token := public.edge_api_editorial_concept_token(p_concept_id);
  if v_token<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive note of at least 10 characters');
  end if;
  if p_action='comment' then
    insert into public.editorial_workflow_events
      (concept_id,actor_id,registered_name,action,note,details)
      values(p_concept_id,p_user_id,v_actor->>'approved_name',
        'comment',v_note,'{}'::jsonb);
  elsif p_action='retire' then
    if v_concept.status not in ('published','draft') then
      return jsonb_build_object('error','review_conflict',
        'message','Only published content or a draft can be retired here');
    end if;
    update public.concepts set status='archived' where id=p_concept_id;
    insert into public.editorial_workflow_events
      (concept_id,actor_id,registered_name,action,note,details)
      values(p_concept_id,p_user_id,v_actor->>'approved_name',
        'content_retired',v_note,jsonb_build_object(
          'content_version',v_concept.content_version,'snapshot',v_snapshot));
  else
    if not coalesce(p_body_valid,false) then
      return jsonb_build_object('error','review_conflict',
        'message','Resolve the concept validation errors before attesting');
    end if;
    if v_concept.status<>'published' or not v_topic_active or not v_subtopic_active then
      return jsonb_build_object('error','review_conflict',
        'message','Choose the exact current published legacy version');
    end if;
    if not exists(select 1 from public.editorial_legacy_versions l
      where l.concept_id=p_concept_id and l.content_version=v_concept.content_version
        and l.snapshot=v_snapshot) then
      return jsonb_build_object('error','review_conflict',
        'message','Only the unchanged inventoried legacy version can be attested');
    end if;
    if exists(select 1 from public.editorial_publications p
      where p.concept_id=p_concept_id and p.content_version=v_concept.content_version) then
      return jsonb_build_object('error','review_conflict',
        'message','This version already has authenticated provenance');
    end if;
    v_body := jsonb_build_object(
      'title',v_concept.title,'summary',v_concept.summary,
      'example',v_concept.example,'subtopic_slug',v_subtopic_slug,
      'curriculum',v_concept.curriculum,
      'learning_package',jsonb_build_object(
        'flashcard',v_concept.flashcard,'mcqs',v_concept.mcqs),
      'model',v_concept.model,'prompt_version',v_concept.prompt_version);
    v_problem := public.edge_api_editorial_candidate_problem(
      p_concept_id,v_concept.slug,v_body);
    if v_problem is not null then
      return jsonb_build_object('error','review_conflict','message',v_problem);
    end if;
    insert into public.editorial_revision_events
      (revision_id,concept_id,base_version,actor_id,registered_name,action,
       revision_body,source_snapshot,note,checklist_version,quality_review)
      values(null,p_concept_id,v_concept.content_version,p_user_id,
        v_actor->>'approved_name','attested',v_body,v_snapshot,v_note,1,p_quality)
      returning id into v_event;
    insert into public.editorial_publications
      (concept_id,content_version,approval_id,snapshot)
      values(p_concept_id,v_concept.content_version,v_event,v_snapshot);
  end if;
  select c.* into v_concept from public.concepts c where c.id=p_concept_id;
  v_result := jsonb_build_object(
    'concept_id',p_concept_id,'status',v_concept.status,
    'content_version',v_concept.content_version,
    'token',public.edge_api_editorial_concept_token(p_concept_id));
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_quality_valid(jsonb)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_quality_valid(jsonb)
  to service_role;
revoke all on function public.edge_api_editorial_concept_token(uuid)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_concept_token(uuid)
  to service_role;
revoke all on function public.edge_api_editorial_candidate_problem(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_candidate_problem(uuid,text,jsonb)
  to service_role;
revoke all on function public.edge_api_editorial_concept_action(
  uuid,uuid,text,uuid,uuid,text,text,text,jsonb,boolean,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_concept_action(
  uuid,uuid,text,uuid,uuid,text,text,text,jsonb,boolean,text)
  to service_role;

commit;

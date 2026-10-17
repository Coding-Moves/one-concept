-- Versioned review actions and publication retain the exact approval evidence.
begin;

create function public.edge_api_editorial_revision_token(p_revision_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'id',r.id,'concept_id',r.concept_id,'base_version',r.base_version,
      'body',r.body,'status',r.status,'assigned_to',r.assigned_to,
      'review_due_at',public.edge_api_editorial_utc_iso(r.review_due_at),
      'source_snapshot',to_jsonb(c)-array['created_at','published_at','status'],
      'concept_status',c.status,'topic_active',t.is_active,
      'subtopic_active',s.is_active,'subtopic_slug',s.slug)),
    'UTF8')),'hex') from public.concept_revisions r
    join public.concepts c on c.id=r.concept_id
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where r.id=p_revision_id
$$;

create function public.edge_api_editorial_revision_action(
  p_user_id uuid, p_session_id uuid, p_aal text, p_revision_id uuid,
  p_request_id uuid, p_note text, p_expected_token text, p_action text,
  p_quality jsonb, p_assignee_id uuid, p_due_at timestamptz,
  p_has_due boolean, p_body_valid boolean,
  p_auto_correction boolean, p_generation_enabled boolean,
  p_queue_limit integer, p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_capability text;
  v_receipt public.editorial_request_receipts%rowtype;
  v_revision public.concept_revisions%rowtype;
  v_concept public.concepts%rowtype;
  v_assignee public.editorial_memberships%rowtype;
  v_approval public.editorial_revision_events%rowtype;
  v_topic_active boolean;
  v_subtopic_active boolean;
  v_subtopic_slug text;
  v_snapshot jsonb;
  v_status text;
  v_note text;
  v_problem text;
  v_event uuid;
  v_request_event uuid;
  v_version integer;
  v_generation_status text;
  v_source_token text;
  v_result jsonb;
begin
  if p_revision_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or p_action is null or p_action not in
      ('submit','comment','assign','changes_requested','rejected',
       'approved','publish','approve_and_publish','retired')
    or ((p_action in ('approved','approve_and_publish')) is distinct from
      (p_quality is not null))
    or (p_quality is not null and not coalesce(
      public.edge_api_editorial_quality_valid(p_quality),false))
    or (p_action<>'assign' and (p_assignee_id is not null or coalesce(p_has_due,false)))
    or p_queue_limit is null or p_queue_limit<1 or p_queue_limit>250
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid');
  end if;
  v_capability := case
    when p_action in ('approved','approve_and_publish','retired') then 'approve'
    when p_action='publish' then 'publish'
    when p_action='assign' then 'manage_reviewers'
    else 'review' end;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,v_capability);
  if v_actor ? 'error' then return v_actor; end if;
  if p_action='approve_and_publish' then
    v_actor := public.edge_api_editorial_authorize(
      p_user_id,p_session_id,p_aal,'publish');
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
  if p_action='approve_and_publish' then
    v_actor := public.edge_api_editorial_authorize(
      p_user_id,p_session_id,p_aal,'publish');
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
  select r.* into v_revision from public.concept_revisions r
    where r.id=p_revision_id for update;
  if not found then return jsonb_build_object('error','revision_not_found'); end if;
  select c.* into v_concept from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=v_revision.concept_id for update of c,t,s;
  select t.is_active,s.is_active,s.slug into
    v_topic_active,v_subtopic_active,v_subtopic_slug
    from public.topics t join public.subtopics s on s.topic_id=t.id
    where s.id=v_concept.subtopic_id;
  v_snapshot := to_jsonb(v_concept)-array['created_at','published_at','status'];
  if public.edge_api_editorial_revision_token(p_revision_id)<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  if v_revision.status='generating' then
    return jsonb_build_object('error','review_conflict',
      'message','Generation is still running; reload when the draft is ready');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive review note (at least 10 characters)');
  end if;
  if p_action in ('submit','assign','approved','changes_requested',
    'rejected','publish','approve_and_publish') and
    not (p_action='publish' and v_revision.status='published') and
    (v_revision.base_version<>v_concept.content_version
      or v_concept.status='archived' or not v_topic_active
      or not v_subtopic_active) then
    return jsonb_build_object('error','review_conflict',
      'message','Revision is stale or content is retired');
  end if;

  if p_action='submit' then
    if v_revision.status<>'draft' then
      return jsonb_build_object('error','review_conflict',
        'message','Only a new draft can be submitted; corrections need a new revision');
    end if;
    v_status := case when coalesce(p_body_valid,false)
      and v_revision.body->>'subtopic_slug'=v_subtopic_slug
      then 'pending_review' else 'validation_failed' end;
    insert into public.editorial_revision_events
      (revision_id,concept_id,base_version,actor_id,registered_name,action,
       revision_body,source_snapshot,note)
      values(p_revision_id,v_revision.concept_id,v_revision.base_version,p_user_id,
        v_actor->>'approved_name',v_status,v_revision.body,v_snapshot,v_note);
    update public.concept_revisions set status=v_status where id=p_revision_id;
  elsif p_action in ('approved','changes_requested','rejected','retired',
    'approve_and_publish') then
    if (p_action='retired' and v_revision.status not in
      ('draft','validation_failed','pending_review','changes_requested',
       'approved','rejected')) or
      (p_action<>'retired' and v_revision.status<>'pending_review') then
      return jsonb_build_object('error','review_conflict',
        'message','Invalid revision transition; reload before reviewing');
    end if;
    if p_action in ('approved','approve_and_publish') and
      (not coalesce(p_body_valid,false) or
        v_revision.body->>'subtopic_slug' is distinct from v_subtopic_slug) then
      return jsonb_build_object('error','review_conflict',
        'message','Approval requires matching taxonomy and the complete quality checklist');
    end if;
    if p_action='approve_and_publish' then
      v_problem := public.edge_api_editorial_candidate_problem(
        v_concept.id,v_concept.slug,v_revision.body);
      if v_problem is not null then
        return jsonb_build_object('error','review_conflict','message',v_problem);
      end if;
    end if;
    v_status := case when p_action='approve_and_publish' then 'approved'
      else p_action end;
    insert into public.editorial_revision_events
      (revision_id,concept_id,base_version,actor_id,registered_name,action,
       revision_body,source_snapshot,note,checklist_version,quality_review)
      values(p_revision_id,v_revision.concept_id,v_revision.base_version,p_user_id,
        v_actor->>'approved_name',v_status,v_revision.body,v_snapshot,v_note,
        case when v_status='approved' then 1 else null end,
        case when v_status='approved' then p_quality else null end)
      returning id into v_event;
    update public.concept_revisions set status=v_status where id=p_revision_id;
    if p_action='changes_requested' and coalesce(p_auto_correction,false) then
      if not coalesce(p_generation_enabled,false) then
        v_generation_status := 'disabled';
      elsif exists(select 1 from public.concept_revisions r
          where r.concept_id=v_revision.concept_id and
            r.created_at>v_revision.created_at)
        or exists(select 1 from public.editorial_generation_jobs j
          where j.source_revision_id=p_revision_id or
            (j.concept_id=v_revision.concept_id and
              j.status in ('pending','generating')))
        or (select count(*) from public.editorial_generation_jobs j
          where j.topic_id=v_concept.topic_id and
            j.status in ('pending','generating'))>=p_queue_limit
        or not coalesce(p_body_valid,false) then
        v_generation_status := 'unavailable';
      else
        insert into public.editorial_workflow_events
          (revision_id,concept_id,topic_id,actor_id,registered_name,
           action,note,details)
          values(p_revision_id,v_revision.concept_id,v_concept.topic_id,p_user_id,
            v_actor->>'approved_name','generation_requested',v_note,
            jsonb_build_object('kind','automatic_review',
              'feedback_event_id',v_event)) returning id into v_request_event;
        v_source_token := encode(pg_catalog.sha256(convert_to(
          public.edge_api_editorial_python_json(jsonb_build_object(
            'revision',public.edge_api_editorial_revision_token(p_revision_id),
            'siblings',(select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb)
              from public.concept_revisions r
              where r.concept_id=v_revision.concept_id))),
          'UTF8')),'hex');
        insert into public.editorial_generation_jobs
          (source_revision_id,concept_id,topic_id,feedback_event_id,
           request_event_id,requested_by,source_token,source_body,feedback)
          values(p_revision_id,v_revision.concept_id,v_concept.topic_id,v_event,
            v_request_event,p_user_id,v_source_token,v_revision.body,v_note);
        v_generation_status := 'queued';
      end if;
    end if;
  elsif p_action='assign' then
    if v_revision.status in ('published','retired') then
      return jsonb_build_object('error','review_conflict',
        'message','Only open review work can be assigned');
    end if;
    if p_assignee_id is not null then
      select * into v_assignee from public.editorial_memberships
        where user_id=p_assignee_id;
      if not found or v_assignee.status<>'active' or
        v_assignee.approved_name is null or
        not (v_assignee.capabilities @> array['review']::text[]) then
        return jsonb_build_object('error','review_conflict',
          'message','Choose an active, approved reviewer');
      end if;
    end if;
    update public.concept_revisions set assigned_to=p_assignee_id,
      review_due_at=case when coalesce(p_has_due,false) then p_due_at
        else v_revision.review_due_at end where id=p_revision_id;
    insert into public.editorial_workflow_events
      (revision_id,concept_id,actor_id,registered_name,action,note,details)
      values(p_revision_id,v_revision.concept_id,p_user_id,
        v_actor->>'approved_name','assigned',v_note,jsonb_build_object(
          'previous_assignee',v_revision.assigned_to,
          'assignee',p_assignee_id,
          'previous_due_at',public.edge_api_editorial_utc_iso(v_revision.review_due_at),
          'review_due_at',public.edge_api_editorial_utc_iso(
            case when coalesce(p_has_due,false) then p_due_at
              else v_revision.review_due_at end)));
  elsif p_action='comment' then
    insert into public.editorial_workflow_events
      (revision_id,concept_id,actor_id,registered_name,action,note,details)
      values(p_revision_id,v_revision.concept_id,p_user_id,
        v_actor->>'approved_name','comment',v_note,'{}'::jsonb);
  end if;

  if p_action in ('publish','approve_and_publish') then
    select * into v_approval from public.editorial_revision_events
      where revision_id=p_revision_id and action='approved';
    if not found then
      return jsonb_build_object('error','review_conflict',
        'message','Authenticated approval of this exact revision is required');
    end if;
    if v_revision.status='published' then
      select content_version into v_version from public.editorial_publications
        where approval_id=v_approval.id;
      if v_version is null then
        return jsonb_build_object('error','review_conflict',
          'message','Published revision has no authenticated provenance');
      end if;
    else
      if p_action='publish' and v_revision.status<>'approved' then
        return jsonb_build_object('error','review_conflict',
          'message','Only an approved, non-retired revision can be published');
      end if;
      if v_approval.revision_body<>v_revision.body or
        v_approval.base_version<>v_revision.base_version or
        v_approval.source_snapshot<>v_snapshot then
        return jsonb_build_object('error','review_conflict',
          'message','Approved content or source version changed; prepare a new revision');
      end if;
      if not coalesce(p_body_valid,false) then
        return jsonb_build_object('error','review_conflict',
          'message','Revision body is invalid');
      end if;
      v_problem := public.edge_api_editorial_candidate_problem(
        v_concept.id,v_concept.slug,v_revision.body);
      if v_problem is not null then
        return jsonb_build_object('error','review_conflict','message',v_problem);
      end if;
      insert into public.concept_revisions
        (concept_id,base_version,body,status,review_note)
        select c.id,c.content_version-1,jsonb_build_object(
          'title',c.title,'summary',c.summary,'example',c.example,
          'flashcard',c.flashcard,'mcqs',c.mcqs,'curriculum',c.curriculum,
          'subtopic_slug',s.slug,'model',c.model,'prompt_version',c.prompt_version),
          'published',
          'Legacy version captured before correction; original review was not recorded.'
        from public.concepts c join public.subtopics s on s.id=c.subtopic_id
        where c.id=v_concept.id and c.content_version>0
          and not exists(select 1 from public.concept_revisions r
            where r.concept_id=c.id and r.status='published'
              and r.base_version=c.content_version-1);
      update public.concepts set
        title=v_revision.body->>'title',summary=v_revision.body->>'summary',
        example=v_revision.body->>'example',
        flashcard=v_revision.body->'learning_package'->'flashcard',
        mcqs=v_revision.body->'learning_package'->'mcqs',
        curriculum=v_revision.body->'curriculum',
        difficulty=(v_revision.body->'curriculum'->>'difficulty')::integer,
        model=v_revision.body->>'model',
        prompt_version=v_revision.body->>'prompt_version',
        content_version=content_version+1,status='published',published_at=now()
        where id=v_concept.id returning content_version into v_version;
      update public.concept_revisions set status='published',
        reviewed_by=v_approval.registered_name,
        review_note=v_approval.note,
        quality_review=v_approval.quality_review,
        reviewed_at=now() where id=p_revision_id;
      insert into public.editorial_publications
        (concept_id,content_version,approval_id,snapshot)
        select c.id,c.content_version,v_approval.id,
          to_jsonb(c)-array['created_at','published_at','status']
          from public.concepts c where c.id=v_concept.id;
      insert into public.editorial_revision_events
        (revision_id,concept_id,base_version,actor_id,registered_name,
         action,revision_body,source_snapshot,note)
        values(p_revision_id,v_revision.concept_id,v_revision.base_version,
          p_user_id,v_actor->>'approved_name','published',
          v_revision.body,v_snapshot,v_note);
    end if;
  end if;
  select r.status into v_status from public.concept_revisions r
    where r.id=p_revision_id;
  v_result := jsonb_build_object(
    'revision_id',p_revision_id,'status',v_status,
    'token',public.edge_api_editorial_revision_token(p_revision_id),
    'published_version',v_version,
    'generation_status',v_generation_status);
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_revision_token(uuid)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_revision_token(uuid)
  to service_role;
revoke all on function public.edge_api_editorial_revision_action(
  uuid,uuid,text,uuid,uuid,text,text,text,jsonb,uuid,timestamptz,
  boolean,boolean,boolean,boolean,integer,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_revision_action(
  uuid,uuid,text,uuid,uuid,text,text,text,jsonb,uuid,timestamptz,
  boolean,boolean,boolean,boolean,integer,text)
  to service_role;

commit;

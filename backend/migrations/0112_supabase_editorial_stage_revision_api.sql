-- Stage one reviewed candidate while preserving the account/catalog lock order,
-- idempotent receipt, and immutable revision body.
begin;

-- Python's json.dumps(sort_keys=True,separators=(',', ':'),ensure_ascii=True)
-- over JSON-serializable values. Shared optimistic tokens and receipts must
-- remain byte-identical while FastAPI and Edge run against the same catalog.
create function public.edge_api_editorial_python_json(p_value jsonb)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_kind text := jsonb_typeof(p_value);
  v_result text;
  v_text text;
  v_char text;
  v_code integer;
  v_high integer;
  v_low integer;
  v_key text;
  v_item jsonb;
  v_first boolean;
  v_index integer;
begin
  if v_kind is null or v_kind='null' then return 'null'; end if;
  if v_kind in ('boolean','number') then return p_value::text; end if;
  if v_kind='string' then
    v_text := p_value #>> '{}';
    v_result := '"';
    for v_index in 1..char_length(v_text) loop
      v_char := substr(v_text,v_index,1);
      v_code := ascii(v_char);
      if v_code=34 or v_code=92 then
        v_result := v_result||chr(92)||v_char;
      elsif v_code=8 then v_result := v_result||chr(92)||'b';
      elsif v_code=9 then v_result := v_result||chr(92)||'t';
      elsif v_code=10 then v_result := v_result||chr(92)||'n';
      elsif v_code=12 then v_result := v_result||chr(92)||'f';
      elsif v_code=13 then v_result := v_result||chr(92)||'r';
      elsif v_code<32 or v_code>126 then
        if v_code<=65535 then
          v_result := v_result||chr(92)||'u'||lpad(to_hex(v_code),4,'0');
        else
          v_code := v_code-65536;
          v_high := 55296+v_code/1024;
          v_low := 56320+v_code%1024;
          v_result := v_result||chr(92)||'u'||lpad(to_hex(v_high),4,'0')
            ||chr(92)||'u'||lpad(to_hex(v_low),4,'0');
        end if;
      else v_result := v_result||v_char;
      end if;
    end loop;
    return v_result||'"';
  end if;
  if v_kind='array' then
    v_result := '[';
    v_first := true;
    for v_item in select value from jsonb_array_elements(p_value) loop
      if not v_first then v_result := v_result||','; end if;
      v_result := v_result||public.edge_api_editorial_python_json(v_item);
      v_first := false;
    end loop;
    return v_result||']';
  end if;
  v_result := '{';
  v_first := true;
  for v_key,v_item in select key,value from jsonb_each(p_value)
    order by key collate "C" loop
    if not v_first then v_result := v_result||','; end if;
    v_result := v_result||public.edge_api_editorial_python_json(to_jsonb(v_key))
      ||':'||public.edge_api_editorial_python_json(v_item);
    v_first := false;
  end loop;
  return v_result||'}';
end
$$;

create function public.edge_api_editorial_stage_revision(
  p_user_id uuid, p_session_id uuid, p_aal text, p_concept_id uuid,
  p_request_id uuid, p_note text, p_expected_token text,
  p_body jsonb, p_fingerprint text
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
  v_revision_id uuid;
  v_note text;
  v_problem text;
  v_snapshot jsonb;
  v_token text;
  v_result jsonb;
begin
  if p_concept_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_expected_token is null or p_expected_token !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_body)<>'object'
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  select * into v_receipt from public.editorial_request_receipts
    where actor_id=p_user_id and request_id=p_request_id;
  if found then
    if v_receipt.fingerprint<>p_fingerprint then
      return jsonb_build_object('error','receipt_conflict');
    end if;
    return v_receipt.result;
  end if;
  select c.* into v_concept
    from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=p_concept_id for update of c,t,s;
  if not found then return jsonb_build_object('error','concept_not_found'); end if;
  select t.is_active,s.is_active,s.slug into
    v_topic_active,v_subtopic_active,v_subtopic_slug
    from public.topics t join public.subtopics s on s.topic_id=t.id
    where s.id=v_concept.subtopic_id;
  v_snapshot := to_jsonb(v_concept)-array['created_at','published_at','status'];
  v_token := encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'snapshot',v_snapshot,'status',v_concept.status,
      'topic_active',v_topic_active,'subtopic_active',v_subtopic_active,
      'subtopic_slug',v_subtopic_slug)), 'UTF8')),'hex');
  if v_token<>p_expected_token then
    return jsonb_build_object('error','stale_revision');
  end if;
  if v_concept.status='archived' or not v_topic_active or not v_subtopic_active then
    return jsonb_build_object('error','review_conflict',
      'message','Cannot stage retired content');
  end if;
  if p_body->>'subtopic_slug' is distinct from v_subtopic_slug then
    return jsonb_build_object('error','review_conflict',
      'message','A revision cannot change a concept''s approved subtopic');
  end if;
  -- The Edge parser validates the complete body shape. Repeat the graph check
  -- under the catalog lock, so a concurrent catalog edit cannot change it.
  with recursive walk(slug,route,cycle) as (
    select prereq.value, array[v_concept.slug,prereq.value],
      prereq.value=v_concept.slug
      from jsonb_array_elements_text(coalesce(
        p_body->'curriculum'->'prerequisites','[]'::jsonb)) prereq(value)
    union all
    select child.value, walk.route||child.value,
      child.value=any(walk.route)
      from walk
      left join public.concepts known_concept on known_concept.slug=walk.slug
      left join public.concept_backlog known_backlog on known_backlog.slug=walk.slug
      cross join lateral jsonb_array_elements_text(coalesce(
        known_concept.curriculum->'prerequisites',
        known_backlog.curriculum->'prerequisites','[]'::jsonb)) child(value)
      where not walk.cycle and cardinality(walk.route)<1000
  )
  select case when cycle then 'Prerequisite cycle includes '||slug
    when not exists(select 1 from public.concepts c where c.slug=walk.slug)
      and not exists(select 1 from public.concept_backlog b where b.slug=walk.slug)
      then 'Unknown prerequisite '||slug end
    into v_problem from walk
    where cycle or (not exists(select 1 from public.concepts c where c.slug=walk.slug)
      and not exists(select 1 from public.concept_backlog b where b.slug=walk.slug))
    limit 1;
  if v_problem is not null then
    return jsonb_build_object('error','review_conflict','message',v_problem);
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict',
      'message','Record a substantive note of at least 10 characters');
  end if;
  insert into public.concept_revisions(concept_id,base_version,body)
    values(p_concept_id,v_concept.content_version,p_body) returning id into v_revision_id;
  insert into public.editorial_workflow_events
    (revision_id,concept_id,topic_id,actor_id,registered_name,action,note,details)
    values(v_revision_id,p_concept_id,null,p_user_id,
      v_actor->>'approved_name','staged',v_note,
      jsonb_build_object('base_version',v_concept.content_version));
  v_token := encode(pg_catalog.sha256(convert_to(
    public.edge_api_editorial_python_json(jsonb_build_object(
      'id',v_revision_id,'concept_id',p_concept_id,
      'base_version',v_concept.content_version,'body',p_body,
      'status','draft','assigned_to',null,'review_due_at',null,
      'source_snapshot',v_snapshot,
      'concept_status',v_concept.status,'topic_active',v_topic_active,
      'subtopic_active',v_subtopic_active,'subtopic_slug',v_subtopic_slug)),
      'UTF8')),'hex');
  v_result := jsonb_build_object(
    'revision_id',v_revision_id,'status','draft','token',v_token);
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_python_json(jsonb)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_python_json(jsonb)
  to service_role;
revoke all on function public.edge_api_editorial_stage_revision(
  uuid,uuid,text,uuid,uuid,text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_stage_revision(
  uuid,uuid,text,uuid,uuid,text,text,jsonb,text)
  to service_role;

commit;

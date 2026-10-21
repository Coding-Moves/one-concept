-- One private correction per Edge invocation. Request-time authority is
-- rechecked at claim and completion; a cancelled or newer job fences output.
begin;

create function public.edge_worker_editorial_requester_active(
  p_user_id uuid,p_event_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.editorial_memberships m
    join auth.users u on u.id=m.user_id
    left join public.editorial_workflow_events e on e.id=p_event_id
    where m.user_id=p_user_id and m.status='active'
      and m.approved_name is not null
      and m.capabilities @> array['review']::text[]
      and (m.capabilities @> array['request_generation']::text[]
        or (e.actor_id=m.user_id and e.action='generation_requested'
          and e.details->>'kind'='automatic_review'))
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=statement_timestamp()))
$$;

create function public.edge_worker_editorial_source_current(
  p_job_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.editorial_generation_jobs j
    join public.concept_revisions r on r.id=j.source_revision_id
    join public.concepts c on c.id=j.concept_id
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where j.id=p_job_id and r.concept_id=c.id
      and r.status='changes_requested' and r.base_version=c.content_version
      and c.status<>'archived' and t.is_active and s.is_active
      and j.source_token=encode(pg_catalog.sha256(convert_to(
        public.edge_api_editorial_python_json(jsonb_build_object(
          'revision',public.edge_api_editorial_revision_token(r.id),
          'siblings',(select coalesce(jsonb_agg(sibling.id order by sibling.id),
            '[]'::jsonb) from public.concept_revisions sibling
            where sibling.concept_id=c.id))), 'UTF8')),'hex'))
$$;

create function public.edge_worker_claim_editorial_revision(
  p_daily_cap integer,p_max_concurrent integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_job public.editorial_generation_jobs%rowtype;
  v_day date := (statement_timestamp() at time zone 'America/Los_Angeles')::date;
  v_used integer;
  v_busy integer;
  v_token uuid;
  v_topic text;
  v_subtopic text;
begin
  if p_daily_cap is null or p_daily_cap not between 0 and 10000 or
     p_max_concurrent is null or p_max_concurrent not between 1 and 20 then
    raise exception 'Invalid editorial generation bounds';
  end if;
  if p_daily_cap=0 then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  update public.editorial_generation_jobs set
    status=case when attempts>=3 then 'failed' else 'pending' end,
    claim_token=null,claimed_at=null,failure_code='stale_claim',
    updated_at=clock_timestamp()
    where status='generating' and claimed_at<now()-interval '30 minutes';
  update public.editorial_generation_jobs set
    claim_token=null,claimed_at=null,updated_at=clock_timestamp()
    where status='cancelled' and claimed_at<now()-interval '30 minutes';
  select * into v_job from public.editorial_generation_jobs
    where status='pending' and attempts<3 and available_at<=now()
    order by available_at,created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  if not public.edge_worker_editorial_requester_active(
    v_job.requested_by,v_job.request_event_id) then
    update public.editorial_generation_jobs set status='cancelled',
      failure_code='requester_inactive',available_at=now()+interval '5 minutes',
      updated_at=clock_timestamp() where id=v_job.id;
    return null;
  end if;
  if not public.edge_worker_editorial_source_current(v_job.id) then
    update public.editorial_generation_jobs set status='superseded',
      failure_code=null,available_at=now()+interval '5 minutes',
      updated_at=clock_timestamp() where id=v_job.id;
    return null;
  end if;
  insert into public.generation_daily_usage(budget_day,calls_used)
    values(v_day,0) on conflict do nothing;
  select calls_used into v_used from public.generation_daily_usage
    where budget_day=v_day for update;
  if v_used>=p_daily_cap then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,3);
  select
    (select count(*) from public.concept_backlog
      where status='generating' and claimed_at>=now()-interval '30 minutes')+
    (select count(*) from public.concept_revisions
      where status='generating' and created_at>=now()-interval '30 minutes')+
    (select count(*) from public.editorial_generation_jobs
      where claim_token is not null and claimed_at>=now()-interval '30 minutes')+
    (select count(*) from public.editorial_legacy_batch_entries
      where status='generating' and claimed_at>=now()-interval '30 minutes')
    into v_busy;
  if v_busy>=p_max_concurrent then return null; end if;
  v_token := gen_random_uuid();
  update public.editorial_generation_jobs set status='generating',
    attempts=attempts+1,claim_token=v_token,claimed_at=now(),
    failure_code=null,updated_at=clock_timestamp() where id=v_job.id;
  update public.generation_daily_usage set calls_used=calls_used+1
    where budget_day=v_day;
  select t.name,s.name into v_topic,v_subtopic
    from public.concepts c
    join public.topics t on t.id=c.topic_id
    join public.subtopics s on s.id=c.subtopic_id
    where c.id=v_job.concept_id;
  return jsonb_build_object('id',v_job.id,'claim_token',v_token,
    'source_body',v_job.source_body,'feedback',v_job.feedback,
    'topic',v_topic,'subtopic',v_subtopic);
end
$$;

create function public.edge_worker_finish_editorial_revision(
  p_id uuid,p_token uuid,p_enabled boolean,p_failure text,
  p_summary text,p_example text,p_learning_package jsonb,
  p_model text,p_prompt_version text
) returns text language plpgsql volatile security definer set search_path='' as $$
declare
  v_job public.editorial_generation_jobs%rowtype;
  v_concept public.concepts%rowtype;
  v_source public.concept_revisions%rowtype;
  v_body jsonb;
  v_problem text;
  v_revision uuid;
  v_state text;
  v_code text;
begin
  if p_failure is not null and p_failure not in
      ('provider_error','rate_limited','invalid_output') then
    raise exception 'Invalid editorial failure code';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  select * into v_job from public.editorial_generation_jobs
    where id=p_id for update;
  if not found or v_job.claim_token is distinct from p_token then
    return 'superseded';
  end if;
  if v_job.status='cancelled' then
    update public.editorial_generation_jobs set claim_token=null,
      claimed_at=null,updated_at=clock_timestamp() where id=p_id;
    return 'cancelled';
  end if;
  if v_job.status<>'generating' then return 'superseded'; end if;
  if not coalesce(p_enabled,false) then
    v_state := 'cancelled'; v_code := null;
  elsif not public.edge_worker_editorial_requester_active(
      v_job.requested_by,v_job.request_event_id) then
    v_state := 'cancelled'; v_code := 'requester_inactive';
  elsif not public.edge_worker_editorial_source_current(v_job.id) then
    v_state := 'superseded'; v_code := null;
  elsif p_failure is not null then
    v_state := case when v_job.attempts>=3 then 'failed' else 'pending' end;
    v_code := p_failure;
  else
    if p_summary is null or length(p_summary) not between 100 and 420 or
       p_example is null or length(p_example) not between 40 and 300 or
       jsonb_typeof(p_learning_package)<>'object' or
       jsonb_typeof(p_learning_package->'mcqs')<>'array' or
       jsonb_array_length(p_learning_package->'mcqs')<>3 or
       p_model is null or length(p_model) not between 1 and 120 or
       p_prompt_version is null or length(p_prompt_version) not between 1 and 120 then
      v_problem := 'invalid_output';
    else
      select * into v_concept from public.concepts where id=v_job.concept_id
        for update;
      select * into v_source from public.concept_revisions
        where id=v_job.source_revision_id for update;
      v_body := v_job.source_body || jsonb_build_object(
        'summary',p_summary,'example',p_example,
        'learning_package',p_learning_package,'model',p_model,
        'prompt_version',p_prompt_version);
      v_problem := public.edge_api_editorial_candidate_problem(
        v_job.concept_id,v_concept.slug,v_body);
    end if;
    if v_problem is not null then
      v_state := case when v_job.attempts>=3 then 'failed' else 'pending' end;
      v_code := 'invalid_output';
    else
      insert into public.concept_revisions(
        concept_id,base_version,body,assigned_to)
        values(v_job.concept_id,v_source.base_version,v_body,
          v_source.assigned_to) returning id into v_revision;
      update public.editorial_generation_jobs set status='ready_for_review',
        result_revision_id=v_revision,claim_token=null,claimed_at=null,
        failure_code=null,updated_at=clock_timestamp() where id=p_id;
      return 'ready_for_review';
    end if;
  end if;
  update public.editorial_generation_jobs set status=v_state,
    failure_code=v_code,claim_token=null,claimed_at=null,
    available_at=now()+interval '5 minutes',updated_at=clock_timestamp()
    where id=p_id;
  return v_state;
end
$$;

revoke all on function public.edge_worker_editorial_requester_active(uuid,uuid),
  public.edge_worker_editorial_source_current(uuid),
  public.edge_worker_claim_editorial_revision(integer,integer),
  public.edge_worker_finish_editorial_revision(
    uuid,uuid,boolean,text,text,text,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.edge_worker_editorial_requester_active(uuid,uuid),
  public.edge_worker_editorial_source_current(uuid),
  public.edge_worker_claim_editorial_revision(integer,integer),
  public.edge_worker_finish_editorial_revision(
    uuid,uuid,boolean,text,text,text,jsonb,text,text)
  to service_role;

commit;

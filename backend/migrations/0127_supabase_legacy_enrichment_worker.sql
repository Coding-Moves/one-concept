-- One grounded complete-card draft per Edge invocation. A batch exists only
-- after an owner's explicit selection; this worker never creates one.
begin;

create function public.edge_worker_legacy_finish_empty(p_batch_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if not exists(select 1 from public.editorial_legacy_batch_entries
    where batch_id=p_batch_id and status in ('queued','generating')) then
    update public.editorial_legacy_batches set status='completed',
      finished_at=clock_timestamp()
      where id=p_batch_id and status='running';
  end if;
end
$$;

create function public.edge_worker_claim_legacy_enrichment(
  p_daily_cap integer,p_max_concurrent integer,p_review_limit integer
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_batch public.editorial_legacy_batches%rowtype;
  v_entry public.editorial_legacy_batch_entries%rowtype;
  v_used integer;
  v_busy integer;
  v_review integer;
  v_batch_used integer;
  v_token uuid;
  v_day date := (statement_timestamp() at time zone 'America/Los_Angeles')::date;
  v_concept public.concepts%rowtype;
  v_topic text;
  v_subtopic text;
begin
  if p_daily_cap is null or p_daily_cap not between 0 and 10000 or
     p_max_concurrent is null or p_max_concurrent not between 1 and 20 or
     p_review_limit is null or p_review_limit not between 1 and 250 then
    raise exception 'Invalid legacy enrichment bounds';
  end if;
  if p_daily_cap=0 then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  update public.editorial_legacy_batch_entries set
    status=case when attempts>=3 then 'failed' else 'queued' end,
    claim_token=null,claimed_at=null,failure_code='stale_claim',
    updated_at=clock_timestamp()
    where status='generating' and claimed_at<now()-interval '30 minutes';
  select * into v_batch from public.editorial_legacy_batches
    where status='running' order by started_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  if not public.edge_worker_editorial_requester_active(
    v_batch.requested_by,null) then
    update public.editorial_legacy_batches set status='failed',
      finished_at=clock_timestamp() where id=v_batch.id;
    update public.editorial_legacy_batch_entries set status='skipped',
      failure_code='requester_inactive',updated_at=clock_timestamp()
      where batch_id=v_batch.id and status='queued';
    return null;
  end if;
  select coalesce(sum(attempts),0)::integer into v_batch_used
    from public.editorial_legacy_batch_entries where batch_id=v_batch.id;
  if v_batch_used>=v_batch.quota_limit then
    if exists(select 1 from public.editorial_legacy_batch_entries
      where batch_id=v_batch.id and status='generating') then return null; end if;
    if exists(select 1 from public.editorial_legacy_batch_entries
      where batch_id=v_batch.id and status='queued') then
      update public.editorial_legacy_batches set status='failed',
        finished_at=clock_timestamp() where id=v_batch.id;
      update public.editorial_legacy_batch_entries set status='skipped',
        failure_code='batch_quota_exhausted',updated_at=clock_timestamp()
        where batch_id=v_batch.id and status='queued';
    else
      perform public.edge_worker_legacy_finish_empty(v_batch.id);
    end if;
    return null;
  end if;
  select * into v_entry from public.editorial_legacy_batch_entries
    where batch_id=v_batch.id and status='queued' and attempts<3
    order by created_at,id limit 1 for update skip locked;
  if not found then
    perform public.edge_worker_legacy_finish_empty(v_batch.id);
    return null;
  end if;
  select
    (select count(*) from public.concepts c
      join public.subtopics s on s.id=c.subtopic_id and s.is_active
      where c.topic_id=v_batch.topic_id and (c.status='draft' or
        (c.status='published' and exists(select 1 from public.concept_revisions r
          where r.concept_id=c.id and r.base_version=c.content_version
            and r.status in ('draft','generating','validation_failed',
              'pending_review','changes_requested','approved')))))+
    (select count(*) from public.concept_backlog b
      join public.subtopics s on s.id=b.subtopic_id and s.is_active
      where b.topic_id=v_batch.topic_id and b.status='generating')
    into v_review;
  if v_review>=p_review_limit then return null; end if;
  select * into v_concept from public.concepts where id=v_entry.concept_id;
  if v_concept.status<>'published' or
     v_concept.content_version<>v_entry.base_version or
     exists(select 1 from public.concept_revisions r
       where r.concept_id=v_entry.concept_id and r.status in
         ('draft','generating','validation_failed','pending_review',
          'changes_requested','approved')) then
    update public.editorial_legacy_batch_entries set status='skipped',
      failure_code='source_changed',updated_at=clock_timestamp()
      where id=v_entry.id;
    perform public.edge_worker_legacy_finish_empty(v_batch.id);
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
  update public.editorial_legacy_batch_entries set status='generating',
    attempts=attempts+1,claim_token=v_token,claimed_at=clock_timestamp(),
    failure_code=null,updated_at=clock_timestamp() where id=v_entry.id;
  update public.generation_daily_usage set calls_used=calls_used+1
    where budget_day=v_day;
  select t.name,s.name into v_topic,v_subtopic
    from public.topics t join public.subtopics s on s.topic_id=t.id
    where t.id=v_concept.topic_id and s.id=v_concept.subtopic_id;
  return jsonb_build_object('id',v_entry.id,'claim_token',v_token,
    'source_body',v_entry.source_body,'topic',v_topic,
    'subtopic',v_subtopic,'model',v_batch.model);
end
$$;

create function public.edge_worker_finish_legacy_enrichment(
  p_id uuid,p_token uuid,p_enabled boolean,p_failure text,p_body jsonb
) returns text language plpgsql volatile security definer set search_path='' as $$
declare
  v_entry public.editorial_legacy_batch_entries%rowtype;
  v_batch public.editorial_legacy_batches%rowtype;
  v_concept public.concepts%rowtype;
  v_subtopic_slug text;
  v_state text;
  v_code text;
  v_revision uuid;
  v_reference jsonb;
begin
  if p_failure is not null and p_failure not in
     ('rate_limited','provider_error','provider_configuration',
      'validation_failed','package_invalid','source_missing',
      'safety_blocked','source_changed') then
    raise exception 'Invalid legacy enrichment failure';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  select * into v_entry from public.editorial_legacy_batch_entries
    where id=p_id for update;
  if not found or v_entry.status<>'generating' or
     v_entry.claim_token is distinct from p_token then return 'superseded'; end if;
  select * into v_batch from public.editorial_legacy_batches
    where id=v_entry.batch_id for update;
  if v_batch.status<>'running' or not coalesce(p_enabled,false) then
    v_state := case when v_batch.status in
      ('cancelled','failed','completed') then 'skipped' else 'queued' end;
    v_code := 'batch_stopped';
  elsif not public.edge_worker_editorial_requester_active(
      v_batch.requested_by,null) then
    v_state := 'skipped'; v_code := 'requester_inactive';
  elsif p_failure is not null then
    v_state := case when p_failure in
      ('validation_failed','package_invalid','source_missing',
       'safety_blocked','provider_configuration') then 'blocked'
      when v_entry.attempts>=3 then 'failed' else 'queued' end;
    v_code := p_failure;
  else
    select * into v_concept from public.concepts
      where id=v_entry.concept_id for update;
    select slug into v_subtopic_slug from public.subtopics
      where id=v_concept.subtopic_id;
    if v_concept.status<>'published' or
       v_concept.content_version<>v_entry.base_version or
       exists(select 1 from public.concept_revisions r
         where r.concept_id=v_entry.concept_id and r.status in
           ('draft','generating','validation_failed','pending_review',
            'changes_requested','approved')) then
      v_state := 'skipped'; v_code := 'source_changed';
    elsif jsonb_typeof(p_body)<>'object' or
       p_body->>'title' is distinct from v_entry.source_body->>'title' or
       p_body->>'subtopic_slug' is distinct from v_subtopic_slug or
       jsonb_typeof(p_body->'curriculum'->'references')<>'array' or
       jsonb_array_length(p_body->'curriculum'->'references')<1 or
       length(coalesce(p_body->'curriculum'->>'objective',''))<15 or
       coalesce(p_body->'curriculum'->>'difficulty','') !~ '^[1-3]$' or
       public.edge_api_editorial_candidate_problem(
         v_concept.id,v_concept.slug,p_body) is not null then
      v_state := 'blocked'; v_code := 'validation_failed';
    else
      for v_reference in select value from jsonb_array_elements(
        p_body->'curriculum'->'references') loop
        if jsonb_typeof(v_reference)<>'object' or
           length(coalesce(v_reference->>'title',''))<3 or
           coalesce(v_reference->>'url','') !~ '^https://[^/?#]+($|[/?#])' then
          v_state := 'blocked'; v_code := 'validation_failed';
          exit;
        end if;
      end loop;
      if v_state is null then
        insert into public.concept_revisions(concept_id,base_version,body)
          values(v_entry.concept_id,v_entry.base_version,p_body)
          returning id into v_revision;
        update public.editorial_legacy_batch_entries set
          status='ready_for_review',result_revision_id=v_revision,
          claim_token=null,claimed_at=null,failure_code=null,
          updated_at=clock_timestamp() where id=p_id;
        perform public.edge_worker_legacy_finish_empty(v_entry.batch_id);
        return 'ready_for_review';
      end if;
    end if;
  end if;
  update public.editorial_legacy_batch_entries set status=v_state,
    claim_token=null,claimed_at=null,failure_code=v_code,
    updated_at=clock_timestamp() where id=p_id;
  perform public.edge_worker_legacy_finish_empty(v_entry.batch_id);
  return v_state;
end
$$;

revoke all on function public.edge_worker_legacy_finish_empty(uuid),
  public.edge_worker_claim_legacy_enrichment(integer,integer,integer),
  public.edge_worker_finish_legacy_enrichment(uuid,uuid,boolean,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.edge_worker_legacy_finish_empty(uuid),
  public.edge_worker_claim_legacy_enrichment(integer,integer,integer),
  public.edge_worker_finish_legacy_enrichment(uuid,uuid,boolean,text,jsonb)
  to service_role;

commit;

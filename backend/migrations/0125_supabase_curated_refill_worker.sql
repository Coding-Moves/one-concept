-- One fenced, budgeted curated title per Edge invocation. Model output remains
-- a private draft until a human reviewer approves publication.
begin;

create function public.edge_worker_claim_curated_refill(
  p_topic_id uuid, p_urgent boolean, p_active_days integer, p_low integer,
  p_min_pool integer, p_global_cap integer, p_topic_cap integer,
  p_max_concurrent integer, p_review_limit integer
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_day date := (statement_timestamp() at time zone 'America/Los_Angeles')::date;
  v_topic record;
  v_backlog record;
  v_target integer;
  v_inventory integer;
  v_unread integer;
  v_review integer;
  v_used integer;
  v_topic_used integer;
  v_busy integer;
  v_token uuid;
begin
  if p_urgent is null or p_active_days is null or p_active_days not between 1 and 365 or
     p_low is null or p_low not between 0 and 30 or
     p_min_pool is null or p_min_pool not between 0 and 1000 or
     p_global_cap is null or p_global_cap not between 0 and 100 or
     p_topic_cap is null or p_topic_cap not between 1 and 10 or
     p_max_concurrent is null or p_max_concurrent not between 1 and 20 or
     p_review_limit is null or p_review_limit not between 1 and 250 then
    raise exception 'Invalid curated refill bounds';
  end if;
  if p_global_cap=0 then return null; end if;

  update public.concept_backlog b set
    status=case when b.attempts>=3+(
      select count(*) from public.content_retry_log r where r.backlog_id=b.id)
      then 'failed' else 'pending' end,
    claimed_at=null,claim_token=null
    where b.status='generating' and (
      b.claimed_at is null or b.claimed_at<now()-interval '30 minutes');

  for v_topic in
    select t.id,t.name,
      (select count(*) from public.concepts c
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
       where c.topic_id=t.id and c.status in ('published','draft')) as stocked
      from public.topics t where t.is_active
        and (p_topic_id is null or t.id=p_topic_id)
      order by stocked,t.id
  loop
    perform 1 from public.topics where id=v_topic.id and is_active
      for update skip locked;
    if not found then continue; end if;
    select greatest(p_min_pool,s.target_count) into v_target
      from public.content_supply_targets s
     where s.topic_id=v_topic.id and s.expires_at>now();
    if v_target is null then continue; end if;
    with active as (
      select distinct user_id from public.daily_assignments
       where assigned_at>=now()-make_interval(days=>p_active_days)
      union select user_id from public.daily_reviews
       where assigned_at>=now()-make_interval(days=>p_active_days)
    )
    select coalesce(min((
      select count(*) from public.concepts c
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
       where c.topic_id=v_topic.id and c.status='published'
         and not exists(select 1 from public.daily_assignments da
           where da.user_id=active.user_id and da.concept_id=c.id)
    )),0)::integer into v_unread
      from active join public.user_topics ut on ut.user_id=active.user_id
     where ut.topic_id=v_topic.id;
    if v_unread>p_low then continue; end if;
    select
      (select count(*) from public.concepts c
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
       where c.topic_id=v_topic.id and c.status in ('published','draft')) +
      (select count(*) from public.concept_backlog b
        join public.subtopics s on s.id=b.subtopic_id and s.is_active
       where b.topic_id=v_topic.id and b.status='generating')
      into v_inventory;
    if v_inventory>=v_target then continue; end if;
    select b.id,b.slug,b.title,b.angle,b.difficulty,b.topic_id,b.subtopic_id,
      b.curriculum,s.slug as subtopic_slug,s.name as subtopic_name
      into v_backlog from public.concept_backlog b
      join public.subtopics s on s.id=b.subtopic_id and s.is_active
      where b.topic_id=v_topic.id and b.status='pending'
        and b.attempts<3+(
          select count(*) from public.content_retry_log r where r.backlog_id=b.id)
      order by b.created_at,b.id limit 1 for update of b skip locked;
    if not found then continue; end if;

    -- Preserve Python's lock order: global allowance, topic allowance, then
    -- the shared generation-capacity advisory lock. No reservation is spent
    -- until both caps and review capacity admit this exact claim.
    insert into public.future_refill_daily_usage(budget_day,calls_used)
      values(v_day,0) on conflict do nothing;
    select calls_used into v_used from public.future_refill_daily_usage
      where budget_day=v_day for update;
    if v_used>=p_global_cap then return null; end if;
    insert into public.future_refill_topic_daily_usage(
      budget_day,topic_id,calls_used) values(v_day,v_topic.id,0)
      on conflict do nothing;
    select calls_used into v_topic_used from public.future_refill_topic_daily_usage
      where budget_day=v_day and topic_id=v_topic.id for update;
    if v_topic_used>=p_topic_cap then continue; end if;
    perform pg_advisory_xact_lock(195,3);
    select
      (select count(*) from public.concept_backlog
        where status='generating' and claimed_at>=now()-interval '30 minutes') +
      (select count(*) from public.concept_revisions
        where status='generating' and created_at>=now()-interval '30 minutes') +
      (select count(*) from public.editorial_generation_jobs
        where claim_token is not null and claimed_at>=now()-interval '30 minutes') +
      (select count(*) from public.editorial_legacy_batch_entries
        where status='generating' and claimed_at>=now()-interval '30 minutes')
      into v_busy;
    if v_busy>=p_max_concurrent then return null; end if;
    select
      (select count(*) from public.concepts c
        join public.subtopics s on s.id=c.subtopic_id and s.is_active
       where c.topic_id=v_topic.id and (c.status='draft' or
         (c.status='published' and exists(
           select 1 from public.concept_revisions r
            where r.concept_id=c.id and r.base_version=c.content_version
              and r.status in ('draft','generating','validation_failed',
                'pending_review','changes_requested','approved'))))) +
      (select count(*) from public.concept_backlog b
        join public.subtopics s on s.id=b.subtopic_id and s.is_active
       where b.topic_id=v_topic.id and b.status='generating')
      into v_review;
    if v_review>=p_review_limit then continue; end if;
    v_token := gen_random_uuid();
    update public.concept_backlog set status='generating',
      attempts=attempts+1,claimed_at=now(),claim_token=v_token
      where id=v_backlog.id and status='pending';
    if not found then continue; end if;
    update public.future_refill_daily_usage set calls_used=calls_used+1
      where budget_day=v_day;
    update public.future_refill_topic_daily_usage set calls_used=calls_used+1
      where budget_day=v_day and topic_id=v_topic.id;
    return jsonb_build_object('id',v_backlog.id,'claim_token',v_token,
      'slug',v_backlog.slug,'title',v_backlog.title,
      'angle',v_backlog.angle,'difficulty',v_backlog.difficulty,
      'topic_id',v_backlog.topic_id,'subtopic_id',v_backlog.subtopic_id,
      'curriculum',v_backlog.curriculum,'topic_name',v_topic.name,
      'subtopic_slug',v_backlog.subtopic_slug,
      'subtopic_name',v_backlog.subtopic_name,'target',v_target,
      'budget_day',v_day);
  end loop;
  return null;
end
$$;

create function public.edge_worker_release_curated_refill(
  p_id uuid,p_token uuid,p_code text
)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
  if p_code not in ('rate_limited','provider_error','validation_failed') then
    raise exception 'Invalid curated refill failure';
  end if;
  if p_code='rate_limited' then
    update public.concept_backlog set status='pending',
      attempts=greatest(attempts-1,0),last_error=p_code,
      claimed_at=null,claim_token=null
      where id=p_id and status='generating' and claim_token=p_token;
  else
    update public.concept_backlog b set
      status=case when b.attempts>=3+(
        select count(*) from public.content_retry_log r where r.backlog_id=b.id)
        then 'failed' else 'pending' end,
      last_error=p_code,claimed_at=null,claim_token=null
      where b.id=p_id and b.status='generating' and b.claim_token=p_token;
  end if;
  return found;
end
$$;

create function public.edge_worker_complete_curated_refill(
  p_id uuid,p_token uuid,p_summary text,p_example text,
  p_learning_package jsonb,p_model text,p_prompt_version text
)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_item record;
declare v_concept uuid;
begin
  if p_summary is null or length(p_summary) not between 100 and 420 or
     p_example is null or length(p_example) not between 40 and 300 or
     p_learning_package is null or jsonb_typeof(p_learning_package)<>'object' or
     jsonb_typeof(p_learning_package->'mcqs')<>'array' or
     jsonb_array_length(p_learning_package->'mcqs')<>3 or
     p_model is null or length(p_model) not between 1 and 120 or
     p_prompt_version is null or length(p_prompt_version) not between 1 and 120 then
    raise exception 'Invalid curated refill result';
  end if;
  perform pg_advisory_xact_lock(195,1);
  select b.*,t.is_active as topic_active,s.is_active as subtopic_active,
    s.slug as subtopic_slug into v_item
    from public.concept_backlog b
    join public.topics t on t.id=b.topic_id
    join public.subtopics s on s.id=b.subtopic_id
    where b.id=p_id and b.status='generating' and b.claim_token=p_token
    for update of b;
  if not found then return false; end if;
  if not v_item.topic_active or not v_item.subtopic_active then
    update public.concept_backlog set status='failed',last_error='topic_inactive',
      claimed_at=null,claim_token=null where id=p_id;
    return false;
  end if;
  insert into public.concepts(topic_id,subtopic_id,slug,title,summary,example,
    difficulty,status,source,model,prompt_version,curriculum,content_version)
    values(v_item.topic_id,v_item.subtopic_id,v_item.slug,v_item.title,
      p_summary,p_example,v_item.difficulty,'draft','gemini',p_model,
      p_prompt_version,v_item.curriculum,0)
    on conflict(slug) do nothing returning id into v_concept;
  if v_concept is null then
    update public.concept_backlog set status='failed',
      last_error='slug already exists; nothing published',
      claimed_at=null,claim_token=null where id=p_id;
    return false;
  end if;
  insert into public.concept_revisions(concept_id,base_version,body)
    values(v_concept,0,jsonb_build_object(
      'title',v_item.title,'summary',p_summary,'example',p_example,
      'subtopic_slug',v_item.subtopic_slug,'curriculum',v_item.curriculum,
      'model',p_model,'prompt_version',p_prompt_version,
      'learning_package',p_learning_package));
  update public.concept_backlog set status='done',last_error=null,
    claimed_at=null,claim_token=null where id=p_id;
  return true;
end
$$;

revoke all on function public.edge_worker_claim_curated_refill(
  uuid,boolean,integer,integer,integer,integer,integer,integer,integer),
  public.edge_worker_release_curated_refill(uuid,uuid,text),
  public.edge_worker_complete_curated_refill(
    uuid,uuid,text,text,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.edge_worker_claim_curated_refill(
  uuid,boolean,integer,integer,integer,integer,integer,integer,integer),
  public.edge_worker_release_curated_refill(uuid,uuid,text),
  public.edge_worker_complete_curated_refill(
    uuid,uuid,text,text,jsonb,text,text)
  to service_role;

commit;

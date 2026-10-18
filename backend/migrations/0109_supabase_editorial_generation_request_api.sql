-- A demand request only records bounded supply; generation remains a worker job.
begin;

create function public.edge_api_editorial_request_generation(
  p_user_id uuid, p_session_id uuid, p_aal text, p_topic_id uuid,
  p_request_id uuid, p_note text, p_count integer, p_enabled boolean,
  p_review_limit integer, p_batch_limit integer, p_active_days integer,
  p_fingerprint text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_receipt public.editorial_request_receipts%rowtype;
  v_planned integer;
  v_inventory integer;
  v_load integer;
  v_slots integer;
  v_count integer;
  v_target integer;
  v_event uuid;
  v_result jsonb;
  v_note text;
begin
  if p_topic_id is null or p_request_id is null or p_note is null
    or length(p_note)<10 or length(p_note)>4000
    or p_count is null or p_count<1 or p_count>10
    or p_review_limit is null or p_review_limit<1 or p_review_limit>250
    or p_batch_limit is null or p_batch_limit<1 or p_batch_limit>25
    or p_active_days is null or p_active_days<1 or p_active_days>365
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
  if not coalesce(p_enabled,false) then
    return jsonb_build_object('error','generation_disabled');
  end if;
  if not exists(select 1 from public.topics
    where id=p_topic_id and is_active) then
    return jsonb_build_object('error','review_conflict','message',
      'Choose an active topic');
  end if;
  select count(*)::integer into v_planned
    from public.concept_backlog b join public.subtopics s on s.id=b.subtopic_id
    where b.topic_id=p_topic_id and b.status='pending' and s.is_active
      and b.attempts<3+(select count(*) from public.content_retry_log l
        where l.backlog_id=b.id);
  if v_planned=0 then
    return jsonb_build_object('error','review_conflict','message',
      'No pending curriculum is available; plan lessons before requesting generation');
  end if;
  select count(*)::integer into v_inventory
    from public.concepts c join public.subtopics s
      on s.id=c.subtopic_id and s.is_active
    where c.topic_id=p_topic_id and c.status in ('published','draft');
  select (
    select count(*) from public.concepts c
      join public.subtopics s on s.id=c.subtopic_id
      where c.topic_id=p_topic_id and s.is_active and
        (c.status='draft' or (c.status='published' and exists(
          select 1 from public.concept_revisions r
          where r.concept_id=c.id and r.base_version=c.content_version
            and r.status in ('draft','generating','validation_failed',
              'pending_review','changes_requested','approved'))))
  ) + (
    select count(*) from public.concept_backlog b
      join public.subtopics s on s.id=b.subtopic_id
      where b.topic_id=p_topic_id and s.is_active and b.status='generating'
  ) into v_load;
  v_slots := greatest(0,p_review_limit-v_load);
  if v_slots=0 then
    return jsonb_build_object('error','review_conflict','message',
      'Review backlog is full; review or archive existing drafts first');
  end if;
  v_note := regexp_replace(p_note,'^[[:space:]]+|[[:space:]]+$','','g');
  if length(v_note)<10 then
    return jsonb_build_object('error','review_conflict','message',
      'Record a substantive note of at least 10 characters');
  end if;
  v_count := least(p_count,v_planned,p_batch_limit,v_slots);
  insert into public.content_supply_targets(topic_id,target_count,expires_at)
    values(p_topic_id,v_inventory+v_count,
      now()+make_interval(days=>p_active_days))
    on conflict(topic_id) do update set
      target_count=greatest(excluded.target_count,
        case when public.content_supply_targets.expires_at>now()
          then public.content_supply_targets.target_count else 0 end),
      requested_at=now(),expires_at=excluded.expires_at
    returning target_count into v_target;
  insert into public.editorial_workflow_events
    (topic_id,actor_id,registered_name,action,note,details)
    values(p_topic_id,p_user_id,v_actor->>'approved_name',
      'generation_requested',v_note,jsonb_build_object(
        'requested_count',p_count,'bounded_count',v_count,'target',v_target))
    returning id into v_event;
  v_result := jsonb_build_object('event_id',v_event,
    'status','demand_recorded','target',v_target);
  insert into public.editorial_request_receipts
    (actor_id,request_id,fingerprint,result)
    values(p_user_id,p_request_id,p_fingerprint,v_result);
  return v_result;
end
$$;

revoke all on function public.edge_api_editorial_request_generation(
  uuid,uuid,text,uuid,uuid,text,integer,boolean,integer,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.edge_api_editorial_request_generation(
  uuid,uuid,text,uuid,uuid,text,integer,boolean,integer,integer,integer,text)
  to service_role;

commit;

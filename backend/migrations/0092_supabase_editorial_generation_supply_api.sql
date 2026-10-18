-- Private supply status mirrors FastAPI's active-subtopic and review-capacity counts.
begin;

create function public.edge_api_editorial_generation_supply(
  p_user_id uuid, p_session_id uuid, p_aal text, p_topic_id uuid,
  p_floor integer, p_review_capacity integer,
  p_generation_enabled boolean, p_provider_configured boolean
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_active boolean;
  v_published bigint;
  v_drafts bigint;
  v_pending bigint;
  v_generating bigint;
  v_failed bigint;
  v_ready bigint;
  v_review_load bigint;
  v_target integer;
begin
  if p_floor is null or p_floor < 0
     or p_review_capacity is null or p_review_capacity < 1 or p_review_capacity > 250
     or p_generation_enabled is null or p_provider_configured is null then
    return jsonb_build_object('error','invalid_config');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'review');
  if v_actor ? 'error' then return v_actor; end if;
  select is_active into v_active from public.topics where id=p_topic_id;
  if not found then return jsonb_build_object('error','topic_not_found'); end if;
  select
    (select count(*) from public.concepts c join public.subtopics s on s.id=c.subtopic_id
      where c.topic_id=p_topic_id and s.is_active and c.status='published'),
    (select count(*) from public.concepts c join public.subtopics s on s.id=c.subtopic_id
      where c.topic_id=p_topic_id and s.is_active and c.status='draft'),
    (select count(*) from public.concept_backlog b join public.subtopics s on s.id=b.subtopic_id
      where b.topic_id=p_topic_id and s.is_active and b.status='pending'
        and b.attempts<3+(select count(*) from public.content_retry_log l where l.backlog_id=b.id)),
    (select count(*) from public.concept_backlog b join public.subtopics s on s.id=b.subtopic_id
      where b.topic_id=p_topic_id and s.is_active and b.status='generating'),
    (select count(*) from public.concept_backlog b join public.subtopics s on s.id=b.subtopic_id
      where b.topic_id=p_topic_id and s.is_active and b.status='failed'),
    (select count(*) from public.concept_revisions r join public.concepts c on c.id=r.concept_id
      join public.subtopics s on s.id=c.subtopic_id
      where c.topic_id=p_topic_id and s.is_active and c.status<>'archived'
        and r.base_version=c.content_version
        and r.status in ('draft','pending_review','changes_requested',
          'validation_failed','approved'))
    into v_published,v_drafts,v_pending,v_generating,v_failed,v_ready;
  select
    (select count(*) from public.concepts c join public.subtopics s on s.id=c.subtopic_id
      where c.topic_id=p_topic_id and s.is_active and (c.status='draft' or
        (c.status='published' and exists(select 1 from public.concept_revisions r
          where r.concept_id=c.id and r.base_version=c.content_version
            and r.status in ('draft','generating','validation_failed',
              'pending_review','changes_requested','approved'))))) +
    (select count(*) from public.concept_backlog b join public.subtopics s on s.id=b.subtopic_id
      where b.topic_id=p_topic_id and s.is_active and b.status='generating')
    into v_review_load;
  select greatest(p_floor,coalesce(
    (select target_count from public.content_supply_targets
     where topic_id=p_topic_id and expires_at>now()),0)) into v_target;
  return jsonb_build_object(
    'topic_id',p_topic_id,'active',v_active,
    'published',v_published,'drafts',v_drafts,'pending',v_pending,
    'generating',v_generating,'failed',v_failed,'ready_for_review',v_ready,
    'target',v_target,'review_load',v_review_load,
    'review_capacity',p_review_capacity,
    'review_blocked',v_review_load>=p_review_capacity,
    'planning_required',v_active and v_pending=0 and v_generating=0
      and v_published+v_drafts<v_target,
    'generation_enabled',p_generation_enabled,
    'provider_configured',p_provider_configured
  );
end
$$;

revoke all on function public.edge_api_editorial_generation_supply(
  uuid,uuid,text,uuid,integer,integer,boolean,boolean
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_generation_supply(
  uuid,uuid,text,uuid,integer,integer,boolean,boolean
) to service_role;

commit;

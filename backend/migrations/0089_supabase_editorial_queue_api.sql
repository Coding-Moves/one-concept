-- Preserve the three private queue views and their snapshot-consistent totals.
begin;

create function public.edge_api_editorial_queue(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_kind text, p_status text, p_topic_id uuid, p_assignee_id uuid,
  p_subtopic_id uuid, p_urgency text, p_search text,
  p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_total bigint;
  v_items jsonb;
  v_next uuid;
begin
  if p_kind is null or p_kind not in ('revisions','legacy','published')
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_search is null or length(p_search) > 120
     or (p_status is not null and p_status not in (
       'generating','draft','validation_failed','pending_review',
       'changes_requested','approved','rejected','published','retired'))
     or (p_urgency is not null and p_urgency not in (
       'overdue','scheduled','unscheduled')) then
    return jsonb_build_object('error', 'invalid_page');
  end if;
  if p_kind <> 'revisions' and (p_status is not null or p_assignee_id is not null
     or p_urgency is not null) then
    return jsonb_build_object('error', 'invalid_filter');
  end if;
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id, p_session_id, p_aal, array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;

  with filtered as (
    select rrow.id, to_jsonb(rrow) as item from (
      select r.id,r.concept_id,c.slug,r.body->>'title' as title,r.status,
        r.base_version,r.assigned_to,r.review_due_at,r.created_at,c.content_version,
        t.name as topic_name,s.name as subtopic_name,c.topic_id,c.subtopic_id,
        (select e.registered_name from public.editorial_revision_events e
          where e.revision_id=r.id and e.action='approved' limit 1) as approved_by,
        (r.review_due_at<statement_timestamp() and r.status not in ('published','retired')) as overdue
      from public.concept_revisions r join public.concepts c on c.id=r.concept_id
      join public.topics t on t.id=c.topic_id
      join public.subtopics s on s.id=c.subtopic_id
      where p_kind='revisions'
        and ((p_status is not null and r.status=p_status)
          or (p_status is null and r.status not in ('published','retired')))
        and (p_topic_id is null or c.topic_id=p_topic_id)
        and (p_subtopic_id is null or c.subtopic_id=p_subtopic_id)
        and (p_assignee_id is null or r.assigned_to=p_assignee_id)
        and (p_urgency is null or
          (p_urgency='overdue' and r.review_due_at<statement_timestamp()
            and r.status not in ('published','retired')) or
          (p_urgency='scheduled' and r.review_due_at>=statement_timestamp()
            and r.status not in ('published','retired')) or
          (p_urgency='unscheduled' and r.review_due_at is null))
        and (p_search='' or strpos(lower(coalesce(r.body->>'title',c.title)),lower(p_search))>0)
    ) rrow
    union all
    select lrow.id, to_jsonb(lrow) from (
      select c.id,c.slug,c.title,c.content_version,t.name as topic_name,
        s.name as subtopic_name,c.topic_id,c.subtopic_id,c.status,
        (l.snapshot=to_jsonb(c)-array['created_at','published_at','status']) as unchanged
      from public.editorial_legacy_versions l join public.concepts c
        on l.concept_id=c.id and l.content_version=c.content_version
      join public.topics t on t.id=c.topic_id
      join public.subtopics s on s.id=c.subtopic_id
      where p_kind='legacy' and c.status='published'
        and not exists(select 1 from public.editorial_publications p
          where p.concept_id=c.id and p.content_version=c.content_version)
        and (p_topic_id is null or c.topic_id=p_topic_id)
        and (p_subtopic_id is null or c.subtopic_id=p_subtopic_id)
        and (p_search='' or strpos(lower(c.title),lower(p_search))>0)
    ) lrow
    union all
    select prow.id, to_jsonb(prow) from (
      select c.id,c.slug,c.title,c.content_version,t.name as topic_name,
        s.name as subtopic_name,c.topic_id,c.subtopic_id,c.status,
        true as verified,
        (select e.registered_name from public.editorial_revision_events e
          where e.id=p.approval_id) as approved_by
      from public.editorial_publications p join public.concepts c
        on p.concept_id=c.id and p.content_version=c.content_version
      join public.topics t on t.id=c.topic_id
      join public.subtopics s on s.id=c.subtopic_id
      where p_kind='published' and c.status='published'
        and p.snapshot=to_jsonb(c)-array['created_at','published_at','status']
        and (p_topic_id is null or c.topic_id=p_topic_id)
        and (p_subtopic_id is null or c.subtopic_id=p_subtopic_id)
        and (p_search='' or strpos(lower(c.title),lower(p_search))>0)
    ) prow
  ), page as (
    select id,item from filtered where p_cursor is null or id>p_cursor
    order by id limit p_limit + 1
  ), numbered as (
    select page.*,row_number() over(order by id) as position from page
  )
  select (select count(*) from filtered),
         coalesce(jsonb_agg(item order by id) filter(where position<=p_limit), '[]'::jsonb),
         (select id from numbered where position=p_limit
           and exists(select 1 from numbered where position>p_limit))
    into v_total,v_items,v_next from numbered;
  return jsonb_build_object('items',v_items,'total',v_total,'next_cursor',v_next);
end
$$;

revoke all on function public.edge_api_editorial_queue(
  uuid,uuid,text,text,text,uuid,uuid,uuid,text,text,uuid,integer
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_queue(
  uuid,uuid,text,text,text,uuid,uuid,uuid,text,text,uuid,integer
) to service_role;

commit;

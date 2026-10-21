-- Owner reviewer metrics preserve historical identities and bounded UUID paging.
begin;

create function public.edge_api_editorial_owner_reviewers(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_start date, p_end date, p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_window jsonb;
  v_start timestamptz;
  v_stop timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_next uuid;
  v_count integer := 0;
  v_has_more boolean := false;
  v_row record;
begin
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  if p_limit is null or p_limit<1 or p_limit>50 then
    return jsonb_build_object('error','invalid_page');
  end if;
  v_window := public.edge_api_editorial_owner_window(p_start,p_end);
  if v_window ? 'error' then return v_window; end if;
  perform pg_catalog.set_config('statement_timeout','5s',true);
  perform pg_catalog.set_config('TimeZone','UTC',true);
  v_start := (v_window->>'start')::timestamptz;
  v_stop := (v_window->>'stop')::timestamptz;
  for v_row in
    with identities as (
      select user_id as id from public.editorial_memberships
      union select actor_id from public.editorial_revision_events
        where created_at>=v_start and created_at<v_stop
      union select e.actor_id from public.editorial_publications p
        join public.editorial_revision_events e on e.id=p.approval_id
        where p.recorded_at>=v_start and p.recorded_at<v_stop
    ), page as (
      select id from identities where p_cursor is null or id>p_cursor
        order by id limit p_limit+1
    ), evidence as (
      select e.* from public.editorial_revision_events e
        join page on page.id=e.actor_id
        where e.created_at>=v_start and e.created_at<v_stop
    ), counts as (
      select actor_id,
        count(*) filter(where action in ('approved','attested')) as approval_events,
        count(distinct concept_id) filter(where action in ('approved','attested')) as approved_concepts,
        count(*) filter(where action='rejected') as rejections,
        count(*) filter(where action='changes_requested') as changes_requested
        from evidence group by actor_id
    ), published as (
      select e.actor_id,count(distinct p.concept_id) as published_concepts
        from public.editorial_publications p
        join public.editorial_revision_events e on e.id=p.approval_id
        join page on page.id=e.actor_id
        where p.recorded_at>=v_start and p.recorded_at<v_stop
        group by e.actor_id
    ), work as (
      select assigned_to,count(*) as pending,
        count(*) filter(where review_due_at<statement_timestamp()) as overdue
        from public.concept_revisions r
        join public.concepts c on c.id=r.concept_id
        join page on page.id=r.assigned_to
        where r.status in ('draft','pending_review','changes_requested',
          'validation_failed','approved') and r.base_version=c.content_version
          and c.status<>'archived' group by assigned_to
    )
    select page.id,
      coalesce(signature.registered_name,m.approved_name,'Name pending') as name,
      signature.created_at as signature_at,
      coalesce(m.status,'deleted') as status,
      coalesce(approval_events,0) as approval_events,
      coalesce(approved_concepts,0) as approved_concepts,
      coalesce(published_concepts,0) as published_concepts,
      coalesce(rejections,0) as rejections,
      coalesce(changes_requested,0) as changes_requested,
      coalesce(pending,0) as pending,coalesce(overdue,0) as overdue
      from page left join public.editorial_memberships m on m.user_id=page.id
      left join counts on counts.actor_id=page.id
      left join published on published.actor_id=page.id
      left join work on work.assigned_to=page.id
      left join lateral (
        select registered_name,created_at from public.editorial_revision_events e
          where actor_id=page.id and created_at<v_stop
          order by created_at desc,id desc limit 1
      ) signature on true order by page.id
  loop
    if v_count>=p_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'id',v_row.id,'name',v_row.name,
      'signature_at',case when v_row.signature_at is null then null
        else public.edge_api_editorial_utc_iso(v_row.signature_at) end,
      'status',v_row.status,'approval_events',v_row.approval_events,
      'approved_concepts',v_row.approved_concepts,
      'published_concepts',v_row.published_concepts,
      'rejections',v_row.rejections,
      'changes_requested',v_row.changes_requested,
      'pending',v_row.pending,'overdue',v_row.overdue));
    v_count := v_count+1;
    v_next := v_row.id;
  end loop;
  return jsonb_build_object(
    'items',v_items,'next_cursor',case when v_has_more then v_next else null end,
    'observed_at',v_window->>'observed_at');
end
$$;

revoke all on function public.edge_api_editorial_owner_reviewers(
  uuid,uuid,text,date,date,uuid,integer) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_owner_reviewers(
  uuid,uuid,text,date,date,uuid,integer) to service_role;

commit;

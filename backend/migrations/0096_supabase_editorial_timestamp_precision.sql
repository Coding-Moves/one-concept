-- Preserve all six microsecond digits in editorial timestamps and cursors.
begin;

create function public.edge_api_editorial_utc_iso_exact(p_value timestamptz)
returns text
language sql stable strict
set search_path = ''
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') ||
    case when extract(microseconds from p_value)::integer % 1000000 = 0
      then '' else '.' || lpad(
        (extract(microseconds from p_value)::integer % 1000000)::text,6,'0') end || '+00:00'
$$;

create or replace function public.edge_api_editorial_utc_iso(p_value timestamptz)
returns text
language sql stable strict
set search_path = ''
as $$
  select public.edge_api_editorial_utc_iso_exact(p_value)
$$;

create or replace function public.edge_api_editorial_activity(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_cursor uuid, p_topic_id uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('error', 'invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id, p_session_id, p_aal, 'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select e.id, to_jsonb(e) || jsonb_build_object('created_at',
      public.edge_api_editorial_utc_iso(e.created_at)) as item from public.editorial_workflow_events e
     where (p_cursor is null or e.id > p_cursor)
       and (p_topic_id is null or e.topic_id = p_topic_id)
     order by e.id limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position <= p_limit), '[]'::jsonb),
         (select id from numbered where position = p_limit
           and exists(select 1 from numbered where position > p_limit))
    into v_items, v_next from numbered;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

create or replace function public.edge_api_editorial_revision_history(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_concept_id uuid, p_cursor uuid, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('error', 'invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id, p_session_id, p_aal, array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;
  if p_concept_id is null or not exists(
    select 1 from public.concepts where id=p_concept_id
  ) then
    return jsonb_build_object('error', 'concept_not_found');
  end if;
  with page as (
    select r.id, jsonb_build_object(
      'id',r.id,'base_version',r.base_version,'status',r.status,
      'created_at',public.edge_api_editorial_utc_iso(r.created_at),'assigned_to',r.assigned_to
    ) as item
    from public.concept_revisions r
    where r.concept_id=p_concept_id and (p_cursor is null or r.id>p_cursor)
    order by r.id limit p_limit+1
  ), numbered as (
    select page.*,row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position<=p_limit), '[]'::jsonb),
         (select id from numbered where position=p_limit
           and exists(select 1 from numbered where position>p_limit))
    into v_items,v_next from numbered;
  return jsonb_build_object('items',v_items,'next_cursor',v_next);
end
$$;

create or replace function public.edge_api_editorial_concept_timeline(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_concept_id uuid, p_after_at timestamptz, p_after_key text, p_limit integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next text;
begin
  if p_limit is null or p_limit<1 or p_limit>100 then
    return jsonb_build_object('error','invalid_page');
  end if;
  if (p_after_at is null) <> (p_after_key is null)
    or (p_after_key is not null and p_after_key !~* '^[rw]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    return jsonb_build_object('error','invalid_cursor');
  end if;
  v_actor := public.edge_api_editorial_authorize_any(
    p_user_id,p_session_id,p_aal,array['review','approve','publish']);
  if v_actor ? 'error' then return v_actor; end if;
  if p_concept_id is null or not exists(
    select 1 from public.concepts where id=p_concept_id
  ) then
    return jsonb_build_object('error','concept_not_found');
  end if;
  with events as (
    select 'r:'||e.id::text as id,e.revision_id,e.actor_id,
      e.registered_name,e.action,e.note,
      jsonb_build_object('base_version',e.base_version,
        'checklist_version',e.checklist_version,
        'quality_review',e.quality_review) as details,e.created_at
    from public.editorial_revision_events e where e.concept_id=p_concept_id
    union all
    select 'w:'||e.id::text,e.revision_id,e.actor_id,e.registered_name,
      e.action,e.note,e.details,e.created_at
    from public.editorial_workflow_events e where e.concept_id=p_concept_id
  ), page as (
    select *,row_number() over(order by created_at,id) as position
    from (select * from events
      where p_after_at is null or (created_at,id)>(p_after_at,p_after_key)
      order by created_at,id limit p_limit+1) bounded
  )
  select coalesce(jsonb_agg((to_jsonb(page)-'position') || jsonb_build_object(
    'created_at',public.edge_api_editorial_utc_iso(page.created_at))
    order by created_at,id)
           filter(where position<=p_limit),'[]'::jsonb),
         (select rtrim(translate(replace(encode(convert_to(
           format('["%s", "%s"]',
             public.edge_api_editorial_utc_iso(last.created_at),last.id),
             'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
          from page last where last.position=p_limit
            and exists(select 1 from page extra where extra.position>p_limit))
    into v_items,v_next from page;
  return jsonb_build_object('items',v_items,'next_cursor',v_next);
end
$$;
revoke all on function public.edge_api_editorial_utc_iso_exact(timestamptz)
  from public, anon, authenticated;
grant execute on function public.edge_api_editorial_utc_iso_exact(timestamptz)
  to service_role;

commit;

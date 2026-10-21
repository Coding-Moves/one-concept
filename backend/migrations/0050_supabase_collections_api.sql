-- Bounded learner history and saved pages for the candidate Edge API.
-- The Edge handler passes a user ID only after verifying the bearer token.
begin;

create function public.edge_api_history(
  p_user_id uuid, p_before date, p_limit integer
)
returns jsonb
language sql stable
set search_path = ''
as $$
  with page as materialized (
    select a.concept_id, a.assigned_for
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id and c.status = 'published'
     where a.user_id = p_user_id and a.completed_at is not null
       and (p_before is null or a.assigned_for < p_before)
     order by a.assigned_for desc
     limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by assigned_for desc) as position
      from page
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'concept_slug', c.slug,
        'learned_on', n.assigned_for,
        'title', c.title,
        'topic_name', t.name,
        'like_count', (
          select count(*)::integer from public.concept_interactions ci
          where ci.concept_id = n.concept_id and ci.liked_at is not null
            and ci.user_id <> p_user_id
        )
      ) order by n.assigned_for desc)
      from numbered n
      join public.concepts c on c.id = n.concept_id
      join public.topics t on t.id = c.topic_id
      where n.position <= p_limit
    ), '[]'::jsonb),
    'next_cursor', case when exists(select 1 from numbered where position > p_limit)
      then (select assigned_for::text from numbered where position = p_limit)
      else null end
  )
$$;

create function public.edge_api_saved(
  p_user_id uuid, p_before timestamptz, p_concept_id uuid, p_limit integer
)
returns jsonb
language sql stable
set search_path = ''
as $$
  with page as materialized (
    select i.concept_id, i.saved_at
      from public.concept_interactions i
      join public.concepts c on c.id = i.concept_id and c.status = 'published'
     where i.user_id = p_user_id and i.saved_at is not null
       and (p_before is null or (i.saved_at, i.concept_id) < (p_before, p_concept_id))
     order by i.saved_at desc, i.concept_id desc
     limit p_limit + 1
  ), numbered as (
    select page.*, row_number() over (order by saved_at desc, concept_id desc) as position
      from page
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'concept_slug', c.slug,
        'title', c.title,
        'topic_name', t.name,
        'like_count', (
          select count(*)::integer from public.concept_interactions ci
          where ci.concept_id = n.concept_id and ci.liked_at is not null
            and ci.user_id <> p_user_id
        )
      ) order by n.saved_at desc, n.concept_id desc)
      from numbered n
      join public.concepts c on c.id = n.concept_id
      join public.topics t on t.id = c.topic_id
      where n.position <= p_limit
    ), '[]'::jsonb),
    'next_cursor', case when exists(select 1 from numbered where position > p_limit)
      then (
        select rtrim(translate(replace(encode(convert_to(jsonb_build_array(
          to_char(n.saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00',
          n.concept_id::text
        )::text, 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')
        from numbered n where n.position = p_limit
      )
      else null end
  )
$$;

revoke all on function public.edge_api_history(uuid, date, integer) from public;
revoke all on function public.edge_api_saved(uuid, timestamptz, uuid, integer) from public;
grant execute on function public.edge_api_history(uuid, date, integer) to service_role;
grant execute on function public.edge_api_saved(uuid, timestamptz, uuid, integer) to service_role;

commit;

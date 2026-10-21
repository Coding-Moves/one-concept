-- Account-scoped subtopic progress and acknowledgment for the Edge API.
-- The handler supplies p_user_id only after checking the bearer session.
begin;

create function public.edge_api_subtopic_progress(p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with catalog as (
    select t.slug as topic_slug, t.name as topic_name,
           s.id as subtopic_id, s.slug as subtopic_slug, s.name as subtopic_name,
           array_agg(c.id order by c.id) as ids, count(*)::integer as available
      from public.topics t
      join public.subtopics s on s.topic_id = t.id and s.is_active
      join public.concepts c on c.subtopic_id = s.id and c.status = 'published'
     where t.is_active
     group by t.slug, t.name, s.id, s.slug, s.name
  ), progress as (
    select catalog.*, count(done.concept_id)::integer as completed_concepts
      from catalog
      left join public.user_concept_completions done
        on done.user_id = p_user_id and done.concept_id = any(catalog.ids)
     group by catalog.topic_slug, catalog.topic_name, catalog.subtopic_id,
              catalog.subtopic_slug, catalog.subtopic_name, catalog.ids, catalog.available
  ), resolved as (
    select progress.*,
           (select event.id from public.user_subtopic_completions event
             where event.user_id = p_user_id and event.subtopic_id = progress.subtopic_id
               and event.catalog_signature =
                 md5(array_to_string(progress.ids, ',')) ||
                 md5('one-concept-subtopic-v1:' || array_to_string(progress.ids, ','))
           ) as completion_id
      from progress
  )
  select jsonb_build_object('items', coalesce(jsonb_agg(
    jsonb_build_object(
      'topic_slug', topic_slug, 'topic_name', topic_name,
      'subtopic_slug', subtopic_slug, 'subtopic_name', subtopic_name,
      'completed_concepts', completed_concepts, 'available_concepts', available,
      'completed', completion_id is not null, 'completion_id', completion_id
    ) order by topic_name, subtopic_name
  ), '[]'::jsonb))
    from resolved
$$;

create function public.edge_api_mark_subtopics_seen(p_user_id uuid, p_ids uuid[])
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.user_subtopic_completions
     set seen_at = coalesce(seen_at, now())
   where user_id = p_user_id and id = any(p_ids);
  return true;
end
$$;

revoke all on function public.edge_api_subtopic_progress(uuid) from public;
revoke all on function public.edge_api_mark_subtopics_seen(uuid, uuid[]) from public;
grant execute on function public.edge_api_subtopic_progress(uuid) to service_role;
grant execute on function public.edge_api_mark_subtopics_seen(uuid, uuid[]) to service_role;

commit;

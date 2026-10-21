-- Candidate concept read and idempotent like/save writes for the Edge API.
-- The Edge handler supplies p_user_id only after Supabase Auth validation.
begin;

create function public.edge_api_concept(p_user_id uuid, p_slug text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'title', c.title,
    'summary', c.summary,
    'example', c.example,
    'flashcard', c.flashcard,
    'topic_slug', t.slug,
    'topic_name', t.name,
    'subtopic_slug', s.slug,
    'subtopic_name', s.name,
    'like_count', (
      select count(*)::integer from public.concept_interactions ci
      where ci.concept_id = c.id and ci.liked_at is not null
        and ci.user_id <> p_user_id
    ),
    'content_version', c.content_version,
    'review', (
      select jsonb_build_object(
        'name', e.registered_name,
        'reviewed_at', e.created_at,
        'content_version', p.content_version
      )
      from public.editorial_publications p
      join public.editorial_revision_events e on e.id = p.approval_id
      where p.concept_id = c.id and p.content_version = c.content_version
        and p.snapshot = to_jsonb(c) - array['created_at', 'published_at', 'status']
        and e.concept_id = c.id and e.action in ('approved', 'attested')
    )
  )
  from public.concepts c
  join public.topics t on t.id = c.topic_id
  join public.subtopics s on s.id = c.subtopic_id
  where c.slug = p_slug and c.status = 'published'
$$;

create function public.edge_api_set_interaction(
  p_user_id uuid, p_slug text, p_kind text, p_on boolean
)
returns boolean
language plpgsql volatile
set search_path = ''
as $$
declare
  v_concept_id uuid;
begin
  if p_kind not in ('like', 'save') or p_on is null then
    raise exception 'Invalid interaction';
  end if;

  select id into v_concept_id from public.concepts
  where slug = p_slug and status = 'published';
  if v_concept_id is null then
    return false;
  end if;

  if p_kind = 'like' then
    insert into public.concept_interactions(user_id, concept_id, liked_at)
    values (p_user_id, v_concept_id, case when p_on then now() else null end)
    on conflict (user_id, concept_id) do update
      set liked_at = excluded.liked_at, updated_at = now();
  else
    insert into public.concept_interactions(user_id, concept_id, saved_at)
    values (p_user_id, v_concept_id, case when p_on then now() else null end)
    on conflict (user_id, concept_id) do update
      set saved_at = excluded.saved_at, updated_at = now();
  end if;
  return true;
end
$$;

revoke all on function public.edge_api_concept(uuid, text) from public;
revoke all on function public.edge_api_set_interaction(uuid, text, text, boolean) from public;
grant execute on function public.edge_api_concept(uuid, text) to service_role;
grant execute on function public.edge_api_set_interaction(uuid, text, text, boolean) to service_role;

commit;

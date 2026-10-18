-- Replace a learner's followed topics and return the same state shape as FastAPI.
-- This snapshot intentionally does not select a new daily lesson.
begin;

create function public.edge_api_profile_snapshot(
  p_user_id uuid, p_compact boolean, p_today date default null
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_profile record;
  v_history jsonb;
  v_saved jsonb;
  v_stats jsonb;
  v_followed jsonb;
  v_likes jsonb;
  v_bookmarks jsonb;
  v_versions jsonb;
  v_older jsonb;
  v_assignment_slug text;
  v_limit integer;
begin
  if p_compact is null then raise exception 'Invalid state options'; end if;
  select display_name, bio, avatar_url, timezone,
         coalesce(p_today, (now() at time zone timezone)::date) as today
    into v_profile from public.profiles where id = p_user_id;
  if not found then return null; end if;

  v_limit := case when p_compact then 50 else 2147483646 end;
  v_history := public.edge_api_history(p_user_id, null, v_limit);
  v_saved := public.edge_api_saved(p_user_id, null, null, v_limit);
  v_stats := public.edge_api_stats(p_user_id);

  select coalesce(jsonb_agg(t.slug order by t.sort_order), '[]'::jsonb)
    into v_followed from public.user_topics ut
    join public.topics t on t.id = ut.topic_id and t.is_active
   where ut.user_id = p_user_id;
  select coalesce(jsonb_agg(c.slug order by c.slug) filter (where i.liked_at is not null), '[]'::jsonb),
         coalesce(jsonb_agg(c.slug order by c.slug) filter (where i.saved_at is not null), '[]'::jsonb),
         coalesce(jsonb_agg(c.content_version order by c.slug) filter (where i.saved_at is not null), '[]'::jsonb)
    into v_likes, v_bookmarks, v_versions
    from public.concept_interactions i
    join public.concepts c on c.id = i.concept_id and c.status = 'published'
   where i.user_id = p_user_id;

  v_older := null;
  if p_compact then
    v_older := '{}'::jsonb;
    if v_history->>'next_cursor' is not null then
      select coalesce(jsonb_object_agg(topic_name, n), '{}'::jsonb)
        into v_older from (
          select t.name as topic_name, count(*)::integer as n
            from public.daily_assignments a
            join public.concepts c on c.id = a.concept_id and c.status = 'published'
            join public.topics t on t.id = c.topic_id
           where a.user_id = p_user_id and a.completed_at is not null
             and a.assigned_for < (v_history->>'next_cursor')::date
           group by t.name
        ) older;
    end if;
  end if;

  select c.slug into v_assignment_slug from public.daily_assignments a
    join public.concepts c on c.id = a.concept_id and c.status = 'published'
   where a.user_id = p_user_id and a.assigned_for = v_profile.today;

  return jsonb_build_object(
    'display_name', v_profile.display_name, 'bio', v_profile.bio,
    'avatar_ref', v_profile.avatar_url, 'avatar_url', null,
    'timezone', v_profile.timezone, 'today', v_profile.today,
    'followed_topics', v_followed, 'learned', v_history->'items',
    'likes', v_likes, 'bookmarks', v_bookmarks,
    'bookmark_versions', v_versions, 'saved', v_saved->'items',
    'stats', v_stats, 'learned_before_window', v_older,
    'history_next_cursor', v_history->'next_cursor',
    'saved_next_cursor', v_saved->'next_cursor',
    'assignment_slug', v_assignment_slug,
    'daily', null, 'daily_availability', 'available', 'review', null
  );
end
$$;

create function public.edge_api_set_topics(
  p_user_id uuid, p_slugs text[], p_compact boolean, p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_keep uuid[];
  v_unknown text[];
begin
  if p_slugs is null or cardinality(p_slugs) > 50
     or array_position(p_slugs, null) is not null or p_compact is null then
    raise exception 'Invalid followed topics';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then return null; end if;

  select coalesce(array_agg(t.id), '{}'::uuid[])
    into v_keep from public.topics t
   where t.slug = any(p_slugs) and t.is_active;
  select coalesce(array_agg(distinct candidate.slug order by candidate.slug), '{}'::text[])
    into v_unknown from unnest(p_slugs) as candidate(slug)
   where not exists(select 1 from public.topics t
     where t.slug = candidate.slug and t.is_active);
  if cardinality(v_unknown) > 0 then
    return jsonb_build_object('error', 'unknown_topics', 'topics', to_jsonb(v_unknown));
  end if;

  delete from public.user_topics
   where user_id = p_user_id and not (topic_id = any(v_keep));
  insert into public.user_topics(user_id, topic_id)
  select p_user_id, unnest(v_keep)
  on conflict do nothing;
  return public.edge_api_profile_snapshot(p_user_id, p_compact, p_today);
end
$$;

revoke all on function public.edge_api_profile_snapshot(uuid, boolean, date) from public;
revoke all on function public.edge_api_set_topics(uuid, text[], boolean, date) from public;
grant execute on function public.edge_api_profile_snapshot(uuid, boolean, date) to service_role;
grant execute on function public.edge_api_set_topics(uuid, text[], boolean, date) to service_role;

commit;

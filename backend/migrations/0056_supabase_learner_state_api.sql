-- A single transactional startup snapshot, including today's followed-topic activity.
begin;

create function public.edge_api_state(
  p_user_id uuid, p_compact boolean, p_reviews boolean,
  p_low integer, p_reserve integer, p_active_days integer,
  p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_profile record;
  v_daily jsonb;
  v_review jsonb;
  v_history jsonb;
  v_saved jsonb;
  v_stats jsonb;
  v_followed jsonb;
  v_likes jsonb;
  v_bookmarks jsonb;
  v_versions jsonb;
  v_older jsonb;
  v_availability text;
  v_assignment_slug text;
  v_limit integer;
begin
  if p_compact is null or p_reviews is null then
    raise exception 'Invalid state options';
  end if;
  -- Daily selection bootstraps a legacy profile, locks it, and owns today's slot.
  v_daily := public.edge_api_daily(
    p_user_id, p_low, p_reserve, p_active_days, p_today
  );
  select display_name, bio, avatar_url, timezone,
         coalesce(p_today, (now() at time zone timezone)::date) as today
    into v_profile from public.profiles where id = p_user_id;
  if not found then return null; end if;

  if v_daily->>'reason' is null then
    v_availability := 'available';
    v_assignment_slug := v_daily->'concept'->>'slug';
  elsif v_daily->>'reason' = 'personalization_required' then
    v_availability := 'personalization_required';
  else
    v_availability := 'catalog_exhausted';
    if p_reviews then
      v_review := public.edge_api_choose_review(p_user_id, v_profile.today);
      if v_review is not null then v_availability := 'review_available'; end if;
    end if;
  end if;
  if v_daily->>'reason' is not null then v_daily := null; end if;

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
    'daily', v_daily, 'daily_availability', v_availability,
    'review', v_review
  );
end
$$;

revoke all on function public.edge_api_state(uuid, boolean, boolean, integer, integer, integer, date) from public;
grant execute on function public.edge_api_state(uuid, boolean, boolean, integer, integer, integer, date) to service_role;

commit;

-- Daily selection stays transactional and server-dated in the Edge candidate.
-- The caller's verified identity is supplied by the Edge handler, never by the client.
begin;

create function public.edge_api_daily_payload(p_user_id uuid, p_day date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'assigned_for', a.assigned_for, 'assigned_at', a.assigned_at,
    'completed_at', a.completed_at, 'learned', a.completed_at is not null,
    'outside_followed_topics', false,
    'concept', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'title', c.title, 'summary', c.summary,
      'example', c.example, 'flashcard', c.flashcard,
      'topic_slug', t.slug, 'topic_name', t.name,
      'subtopic_slug', s.slug, 'subtopic_name', s.name,
      'content_version', c.content_version,
      'like_count', (select count(*)::integer from public.concept_interactions ci
        where ci.concept_id = c.id and ci.liked_at is not null and ci.user_id <> p_user_id),
      'review', (select jsonb_build_object(
        'name', e.registered_name, 'reviewed_at', e.created_at,
        'content_version', pub.content_version)
        from public.editorial_publications pub
        join public.editorial_revision_events e on e.id = pub.approval_id
        where pub.concept_id = c.id and pub.content_version = c.content_version
          and c.status = 'published'
          and pub.snapshot = to_jsonb(c) - array['created_at','published_at','status']
          and e.concept_id = c.id and e.action in ('approved', 'attested'))
    )
  )
    from public.daily_assignments a
    join public.concepts c on c.id = a.concept_id and c.status = 'published'
    join public.topics t on t.id = c.topic_id
    join public.subtopics s on s.id = c.subtopic_id
   where a.user_id = p_user_id and a.assigned_for = p_day
$$;

create function public.edge_api_signal_supply(
  p_user_id uuid, p_topic_id uuid, p_low integer, p_reserve integer, p_active_days integer
)
returns void
language sql volatile
set search_path = ''
as $$
  with inventory as (
    select count(*)::integer as published,
      count(*) filter (where exists (
        select 1 from public.daily_assignments a
         where a.user_id = p_user_id and a.concept_id = c.id
      ))::integer as assigned
      from public.concepts c
      join public.topics t on t.id = c.topic_id
      join public.subtopics s on s.id = c.subtopic_id and s.is_active
     where c.topic_id = p_topic_id and c.status = 'published' and t.is_active
  )
  insert into public.content_supply_targets(topic_id, target_count, expires_at)
  select p_topic_id, assigned + p_reserve, now() + make_interval(days => p_active_days)
    from inventory where published - assigned <= p_low
      and exists(select 1 from public.topics where id = p_topic_id and is_active)
  on conflict(topic_id) do update set
    target_count = greatest(
      case when content_supply_targets.expires_at > now()
        then content_supply_targets.target_count else 0 end,
      excluded.target_count),
    requested_at = now(), expires_at = excluded.expires_at
$$;

create function public.edge_api_daily(
  p_user_id uuid, p_low integer default 10, p_reserve integer default 60,
  p_active_days integer default 90, p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_today date;
  v_timezone text;
  v_concept uuid;
  v_topic uuid;
  v_assignment uuid;
  v_payload jsonb;
begin
  if p_low < 0 or p_low > 30 or p_reserve < 1 or p_reserve > 365
     or p_active_days < 1 or p_active_days > 365 then
    raise exception 'Invalid supply configuration';
  end if;

  -- Match the legacy-user safety net without restoring deliberately unfollowed topics.
  with created as (
    insert into public.profiles(id, display_name)
    select p_user_id, split_part(u.email, '@', 1)
      from auth.users u where u.id = p_user_id
    on conflict(id) do nothing returning id
  ), prefs as (
    insert into public.notification_preferences(user_id) values (p_user_id)
    on conflict(user_id) do nothing
  )
  insert into public.user_topics(user_id, topic_id)
  select created.id, t.id from created cross join public.topics t where t.is_active
  on conflict do nothing;

  select timezone into v_timezone
    from public.profiles where id = p_user_id for update;
  if v_timezone is null then
    raise exception 'Profile unavailable';
  end if;
  v_today := coalesce(p_today, (now() at time zone v_timezone)::date);

  if exists(select 1 from public.daily_reviews
    where user_id = p_user_id and assigned_for = v_today) then
    return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
      'detail', 'You have already been assigned every available concept.');
  end if;
  if exists(select 1 from public.daily_assignments
    where user_id = p_user_id and assigned_for = v_today) then
    v_payload := public.edge_api_daily_payload(p_user_id, v_today);
    if v_payload is not null then return v_payload; end if;
    return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
      'detail', 'You have already been assigned every available concept.');
  end if;

  if not exists(select 1 from public.user_topics ut
    join public.topics t on t.id = ut.topic_id and t.is_active
    where ut.user_id = p_user_id) then
    return jsonb_build_object('assigned_for', v_today, 'reason', 'personalization_required',
      'detail', 'Follow at least one topic to receive a daily concept.');
  end if;

  -- Move the most recent unfinished followed lesson, retaining its identity and timestamp.
  with pending as (
    select a.id from public.daily_assignments a
    join public.concepts c on c.id = a.concept_id and c.status = 'published'
    join public.topics t on t.id = c.topic_id and t.is_active
    join public.subtopics s on s.id = c.subtopic_id and s.is_active
    join public.user_topics ut on ut.topic_id = c.topic_id and ut.user_id = p_user_id
    where a.user_id = p_user_id and a.completed_at is null and a.assigned_for < v_today
    order by a.assigned_for desc, a.id limit 1
  )
  update public.daily_assignments a set assigned_for = v_today
    from pending where a.id = pending.id returning a.concept_id into v_concept;
  if v_concept is not null then
    select topic_id into v_topic from public.concepts where id = v_concept;
    perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
    return public.edge_api_daily_payload(p_user_id, v_today);
  end if;

  with pool as (
    select c.id, c.topic_id, coalesce(c.difficulty, 1) as level,
      (select count(*) from jsonb_array_elements_text(
        coalesce(c.curriculum->'prerequisites', '[]'::jsonb)) required(slug)
        where not exists(select 1 from public.daily_assignments learned
          join public.concepts prior on prior.id = learned.concept_id
          where learned.user_id = p_user_id and learned.completed_at is not null
            and prior.slug = required.slug)) as unmet
      from public.concepts c
      join public.topics t on t.id = c.topic_id and t.is_active
      join public.subtopics s on s.id = c.subtopic_id and s.is_active
      where c.status = 'published'
        and exists(select 1 from public.user_topics ut
          where ut.user_id = p_user_id and ut.topic_id = c.topic_id)
        and not exists(select 1 from public.daily_assignments a
          where a.user_id = p_user_id and a.concept_id = c.id)
  ), last_seen as (
    select c.topic_id, max(a.assigned_for) as seen_on
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id and c.status = 'published'
     where a.user_id = p_user_id group by c.topic_id
  )
  select pool.id, pool.topic_id into v_concept, v_topic
    from pool left join last_seen on last_seen.topic_id = pool.topic_id
   order by last_seen.seen_on asc nulls first, pool.unmet asc, pool.level asc, random()
   limit 1;

  if v_concept is not null then
    begin
      insert into public.daily_assignments(id, user_id, concept_id, assigned_for)
      values (gen_random_uuid(), p_user_id, v_concept, v_today)
      on conflict(user_id, assigned_for) do nothing returning id into v_assignment;
    exception when unique_violation then
      v_assignment := null;
    end;
    if v_assignment is not null then
      perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
      v_payload := public.edge_api_daily_payload(p_user_id, v_today);
      if v_payload is not null then return v_payload; end if;
    else
      v_payload := public.edge_api_daily_payload(p_user_id, v_today);
      if v_payload is not null then return v_payload; end if;
    end if;
  else
    -- Request future supply in a followed topic without waiting for generation.
    select ut.topic_id into v_topic from public.user_topics ut
    join public.topics t on t.id = ut.topic_id and t.is_active
    left join (
      select c.topic_id, max(a.assigned_for) as seen_on
      from public.daily_assignments a
      join public.concepts c on c.id = a.concept_id and c.status = 'published'
      where a.user_id = p_user_id group by c.topic_id
    ) seen on seen.topic_id = ut.topic_id
    where ut.user_id = p_user_id
    order by seen.seen_on asc nulls first limit 1;
    if v_topic is not null then
      perform public.edge_api_signal_supply(p_user_id, v_topic, p_low, p_reserve, p_active_days);
    end if;
  end if;
  return jsonb_build_object('assigned_for', v_today, 'reason', 'catalog_exhausted',
    'detail', 'You have already been assigned every available concept.');
end
$$;

revoke all on function public.edge_api_daily_payload(uuid, date) from public;
revoke all on function public.edge_api_signal_supply(uuid, uuid, integer, integer, integer) from public;
revoke all on function public.edge_api_daily(uuid, integer, integer, integer, date) from public;
grant execute on function public.edge_api_daily_payload(uuid, date) to service_role;
grant execute on function public.edge_api_signal_supply(uuid, uuid, integer, integer, integer) to service_role;
grant execute on function public.edge_api_daily(uuid, integer, integer, integer, date) to service_role;

commit;

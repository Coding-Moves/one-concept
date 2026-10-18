-- Review selection and completion share the profile-timezone activity lock.
begin;

create function public.edge_api_review_payload(p_user_id uuid, p_day date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'review_id', r.id, 'assigned_for', r.assigned_for,
    'assigned_at', r.assigned_at, 'completed_at', r.completed_at,
    'learned', r.completed_at is not null, 'outside_followed_topics', false,
    'concept', public.edge_api_concept(p_user_id, c.slug)
  )
    from public.daily_reviews r
    join public.concepts c on c.id = r.concept_id and c.status = 'published'
   where r.user_id = p_user_id and r.assigned_for = p_day
$$;

create function public.edge_api_choose_review(p_user_id uuid, p_today date default null)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_today date;
  v_concept uuid;
begin
  select (now() at time zone timezone)::date into v_today
    from public.profiles where id = p_user_id for update;
  if v_today is null then return null; end if;
  v_today := coalesce(p_today, v_today);

  if exists(select 1 from public.daily_reviews
    where user_id = p_user_id and assigned_for = v_today) then
    return public.edge_api_review_payload(p_user_id, v_today);
  end if;
  if exists(select 1 from public.daily_assignments
    where user_id = p_user_id and assigned_for = v_today) then
    return null;
  end if;
  -- An intentionally empty followed set cannot be widened by a review.
  select a.concept_id into v_concept
    from public.daily_assignments a
    join public.concepts c on c.id = a.concept_id and c.status = 'published'
    join public.topics t on t.id = c.topic_id and t.is_active
    join public.subtopics s on s.id = c.subtopic_id and s.is_active
    join public.user_topics ut on ut.topic_id = c.topic_id and ut.user_id = p_user_id
    left join lateral (
      select max(r.assigned_for) as last_review from public.daily_reviews r
       where r.user_id = p_user_id and r.concept_id = a.concept_id
    ) seen on true
   where a.user_id = p_user_id and a.completed_at is not null
   order by seen.last_review asc nulls first, a.assigned_for, a.concept_id
   limit 1;
  if v_concept is null then return null; end if;
  insert into public.daily_reviews(user_id, concept_id, assigned_for)
  values (p_user_id, v_concept, v_today)
  on conflict(user_id, assigned_for) do nothing;
  return public.edge_api_review_payload(p_user_id, v_today);
end
$$;

create function public.edge_api_complete_review(
  p_user_id uuid, p_review_id uuid, p_today date default null
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_today date;
  v_day date;
begin
  select (now() at time zone timezone)::date into v_today
    from public.profiles where id = p_user_id for update;
  if v_today is null then return null; end if;
  v_today := coalesce(p_today, v_today);
  update public.daily_reviews r
     set completed_at = coalesce(completed_at, now())
   where r.id = p_review_id and r.user_id = p_user_id
     and (r.completed_at is not null or (
       r.assigned_for in (v_today, v_today - 1)
       and not exists(select 1 from public.daily_assignments a
         where a.user_id = p_user_id and a.assigned_for > r.assigned_for)
       and not exists(select 1 from public.daily_reviews newer
         where newer.user_id = p_user_id and newer.assigned_for > r.assigned_for)
     ))
  returning r.assigned_for into v_day;
  if not found then return null; end if;
  perform public.edge_api_award_eligible(p_user_id);
  return jsonb_build_object(
    'completed', true, 'assigned_for', v_day,
    'stats', public.edge_api_stats(p_user_id),
    'subtopic_completion', null
  );
end
$$;

revoke all on function public.edge_api_review_payload(uuid, date) from public;
revoke all on function public.edge_api_choose_review(uuid, date) from public;
revoke all on function public.edge_api_complete_review(uuid, uuid, date) from public;
grant execute on function public.edge_api_review_payload(uuid, date) to service_role;
grant execute on function public.edge_api_choose_review(uuid, date) to service_role;
grant execute on function public.edge_api_complete_review(uuid, uuid, date) to service_role;

commit;

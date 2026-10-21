-- Refresh durable topic demand without scanning every reader in an HTTP GET.
begin;

create function public.edge_worker_plan_active_readers(
  p_days integer, p_reserve integer, p_low integer
)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare v_count integer;
begin
  if p_days is null or p_days not between 1 and 365 or
     p_reserve is null or p_reserve not between 1 and 365 or
     p_low is null or p_low not between 0 and 30 then
    raise exception 'Invalid active reader planning bounds';
  end if;
  with active as (
    select distinct user_id from public.daily_assignments
      where assigned_at>=now()-make_interval(days=>p_days)
    union
    select user_id from public.daily_reviews
      where assigned_at>=now()-make_interval(days=>p_days)
  ), demand as (
    select ut.topic_id,coalesce(max(seen.assigned),0)::integer+p_reserve as target
      from active a
      join public.user_topics ut on ut.user_id=a.user_id
      join public.topics t on t.id=ut.topic_id and t.is_active
      left join lateral (
        select count(*)::integer as published,
          count(*) filter(where exists(
            select 1 from public.daily_assignments da
             where da.user_id=a.user_id and da.concept_id=c.id))::integer as assigned
          from public.concepts c
          join public.subtopics s on s.id=c.subtopic_id and s.is_active
         where c.topic_id=ut.topic_id and c.status='published'
      ) seen on true
     group by ut.topic_id
    having coalesce(min(seen.published-seen.assigned),0)<=p_low
  ), planned as (
    insert into public.content_supply_targets(topic_id,target_count,expires_at)
      select topic_id,target,now()+make_interval(days=>p_days) from demand
      on conflict(topic_id) do update set
        target_count=greatest(excluded.target_count,
          case when public.content_supply_targets.expires_at>now()
            then public.content_supply_targets.target_count else 0 end),
        requested_at=now(),expires_at=excluded.expires_at
      returning topic_id
  )
  select count(*) into v_count from planned;
  return v_count;
end
$$;

revoke all on function public.edge_worker_plan_active_readers(integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.edge_worker_plan_active_readers(integer,integer,integer)
  to service_role;

commit;

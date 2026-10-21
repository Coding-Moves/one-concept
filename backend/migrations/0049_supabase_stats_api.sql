-- Candidate streak statistics for the Edge API. The local day comes from the
-- server-side profile timezone; completion dates remain the credited days.
begin;

create function public.edge_api_stats(p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  with user_day as (
    select (now() at time zone timezone)::date as today
    from public.profiles where id = p_user_id
  ), days as (
    select assigned_for as d from public.daily_assignments
    where user_id = p_user_id and completed_at is not null
    union
    select assigned_for from public.daily_reviews
    where user_id = p_user_id and completed_at is not null
  ), grouped as (
    select d, d - (row_number() over (order by d))::int as grp from days
  ), runs as (
    select grp, count(*)::int as len, max(d) as ends_on
    from grouped group by grp
  )
  select jsonb_build_object(
    'current', coalesce((
      select len from runs where ends_on in (user_day.today, user_day.today - 1)
      order by ends_on desc limit 1
    ), 0),
    'longest', coalesce((select max(len) from runs), 0),
    'total_learned', (
      select count(*)::int from public.daily_assignments
      where user_id = p_user_id and completed_at is not null
    ),
    'total_reviews', (
      select count(*)::int from public.daily_reviews
      where user_id = p_user_id and completed_at is not null
    )
  )
  from user_day
$$;

revoke all on function public.edge_api_stats(uuid) from public;
grant execute on function public.edge_api_stats(uuid) to service_role;

commit;

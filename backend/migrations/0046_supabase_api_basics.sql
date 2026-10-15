-- Candidate Edge API functions. Only the server-side service role may execute
-- these RPCs; an authenticated mobile/site token cannot pass an arbitrary uid.
-- Keep this migration unapplied in production until the candidate is reviewed.
begin;

create function public.edge_api_health()
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object('status', 'ok', 'database', 'reachable')
  from (select 1) as probe
$$;

create function public.edge_api_topics(p_user_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(topic_row) - 'sort_order'
                            order by topic_row.sort_order, topic_row.name), '[]'::jsonb)
  from (
    select t.id, t.slug, t.name, t.description, t.sort_order,
           count(c.id) filter (where c.status = 'published')::integer as concept_count,
           exists (
             select 1 from public.user_topics ut
             where ut.user_id = p_user_id and ut.topic_id = t.id
           ) as following
      from public.topics t
      left join public.concepts c on c.topic_id = t.id
     where t.is_active
     group by t.id, t.slug, t.name, t.description, t.sort_order
  ) topic_row
$$;

revoke all on function public.edge_api_health() from public;
revoke all on function public.edge_api_topics(uuid) from public;
grant execute on function public.edge_api_health() to service_role;
grant execute on function public.edge_api_topics(uuid) to service_role;

commit;

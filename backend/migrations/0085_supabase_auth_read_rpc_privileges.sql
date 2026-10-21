-- Auth tables are deliberately unavailable to service_role. These five
-- service-only RPCs need narrowly scoped owner privileges to read Auth users
-- or sessions after the Edge Function has verified the caller's access token.
begin;

do $guard$
declare
  signature text;
begin
  foreach signature in array array[
    'public.edge_api_daily(uuid,integer,integer,integer,date)',
    'public.edge_api_achievements(uuid)',
    'public.edge_api_weekly_quiz(uuid)',
    'public.edge_api_subtopic_quiz(uuid,uuid)',
    'public.edge_api_editorial_me(uuid,uuid,text)'
  ] loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(signature)
         and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'Auth-reading RPC is missing its empty search_path';
    end if;
  end loop;
end
$guard$;

alter function public.edge_api_daily(uuid, integer, integer, integer, date)
  security definer;
alter function public.edge_api_achievements(uuid)
  security definer;
alter function public.edge_api_weekly_quiz(uuid)
  security definer;
alter function public.edge_api_subtopic_quiz(uuid, uuid)
  security definer;
alter function public.edge_api_editorial_me(uuid, uuid, text)
  security definer;

-- These functions already pin search_path to ''. Do not expose their
-- caller-supplied user/session IDs to an untrusted database role.
revoke all on function public.edge_api_daily(uuid, integer, integer, integer, date)
  from public, anon, authenticated;
revoke all on function public.edge_api_achievements(uuid)
  from public, anon, authenticated;
revoke all on function public.edge_api_weekly_quiz(uuid)
  from public, anon, authenticated;
revoke all on function public.edge_api_subtopic_quiz(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.edge_api_editorial_me(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.edge_api_daily(uuid, integer, integer, integer, date)
  to service_role;
grant execute on function public.edge_api_achievements(uuid) to service_role;
grant execute on function public.edge_api_weekly_quiz(uuid) to service_role;
grant execute on function public.edge_api_subtopic_quiz(uuid, uuid) to service_role;
grant execute on function public.edge_api_editorial_me(uuid, uuid, text)
  to service_role;

commit;

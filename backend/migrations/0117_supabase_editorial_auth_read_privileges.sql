-- These service-only editorial RPCs read auth.users directly. Supabase's
-- service_role cannot read that schema, so execute them as their trusted owner
-- after preserving the empty search_path and narrow EXECUTE grants.
begin;

do $guard$
declare
  signature text;
begin
  foreach signature in array array[
    'public.edge_api_editorial_reviewer_access(uuid,uuid,text,uuid,integer,text,text[])',
    'public.edge_api_editorial_invite_prepare(uuid,uuid,text,text)',
    'public.edge_api_editorial_invite_finish(uuid,uuid,text,text,uuid,text[])'
  ] loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = to_regprocedure(signature)
         and p.proconfig @> array['search_path=""']::text[]
    ) then
      raise exception 'Auth-reading editorial RPC is missing its empty search_path';
    end if;
  end loop;
end
$guard$;

alter function public.edge_api_editorial_reviewer_access(
  uuid,uuid,text,uuid,integer,text,text[]) security definer;
alter function public.edge_api_editorial_invite_prepare(
  uuid,uuid,text,text) security definer;
alter function public.edge_api_editorial_invite_finish(
  uuid,uuid,text,text,uuid,text[]) security definer;

revoke all on function public.edge_api_editorial_reviewer_access(
  uuid,uuid,text,uuid,integer,text,text[]) from public, anon, authenticated;
revoke all on function public.edge_api_editorial_invite_prepare(
  uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.edge_api_editorial_invite_finish(
  uuid,uuid,text,text,uuid,text[]) from public, anon, authenticated;

grant execute on function public.edge_api_editorial_reviewer_access(
  uuid,uuid,text,uuid,integer,text,text[]) to service_role;
grant execute on function public.edge_api_editorial_invite_prepare(
  uuid,uuid,text,text) to service_role;
grant execute on function public.edge_api_editorial_invite_finish(
  uuid,uuid,text,text,uuid,text[]) to service_role;

commit;

-- Share the authenticated API request budget across Edge instances. A user
-- has at most one read and one write bucket, and Auth deletion removes both.
begin;

create table public.edge_api_request_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('read', 'write')),
  tokens double precision not null,
  updated_at timestamptz not null,
  primary key (user_id, kind)
);

alter table public.edge_api_request_buckets enable row level security;
revoke all on public.edge_api_request_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.edge_api_request_buckets to service_role;

create function public.edge_api_request_retry_after(
  p_user_id uuid, p_method text, p_read_limit integer, p_write_limit integer
)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_kind text;
  v_limit integer;
  v_tokens double precision;
  v_updated timestamptz;
  v_now timestamptz;
  v_retry integer;
begin
  if p_user_id is null or p_method is null or
     p_read_limit is null or p_write_limit is null or
     p_read_limit not between 1 and 10000 or
     p_write_limit not between 1 and 10000 then
    raise exception 'Invalid API rate limit configuration';
  end if;
  v_kind := case when p_method in ('GET', 'HEAD', 'OPTIONS')
    then 'read' else 'write' end;
  v_limit := case when v_kind = 'read' then p_read_limit else p_write_limit end;
  v_now := clock_timestamp();
  insert into public.edge_api_request_buckets(user_id, kind, tokens, updated_at)
    values (p_user_id, v_kind, v_limit, v_now)
    on conflict (user_id, kind) do nothing;
  select tokens, updated_at into strict v_tokens, v_updated
    from public.edge_api_request_buckets
   where user_id = p_user_id and kind = v_kind for update;
  v_now := clock_timestamp();
  v_tokens := least(v_limit::double precision,
    v_tokens + greatest(0, extract(epoch from v_now - v_updated)) * v_limit / 60.0);
  if v_tokens < 1 then
    v_retry := greatest(1, ceil((1 - v_tokens) * 60.0 / v_limit)::integer);
  else
    v_tokens := v_tokens - 1;
    v_retry := 0;
  end if;
  update public.edge_api_request_buckets
     set tokens = v_tokens, updated_at = v_now
   where user_id = p_user_id and kind = v_kind;
  return v_retry;
end
$$;

revoke all on function public.edge_api_request_retry_after(uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.edge_api_request_retry_after(uuid,text,integer,integer)
  to service_role;

commit;

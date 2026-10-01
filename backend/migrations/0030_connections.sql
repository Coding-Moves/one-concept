begin;
create table public.connection_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  accepting_requests boolean not null default false,
  version integer not null default 0 check (version >= 0)
);
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  low_user uuid not null references public.profiles(id) on delete cascade,
  high_user uuid not null references public.profiles(id) on delete cascade,
  initiator uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state in ('pending','accepted','declined','canceled','removed')),
  requested_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  unique(low_user,high_user),
  check(low_user < high_user),
  check(initiator = low_user or initiator = high_user)
);
create index connections_low_state on public.connections(low_user,state,id);
create index connections_high_state on public.connections(high_user,state,id);
create table public.connection_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(owner_id,target_id),
  check(owner_id <> target_id)
);
create index connection_blocks_owner_id on public.connection_blocks(owner_id,id);
create table public.connection_request_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now()
);
create index connection_request_events_limit on public.connection_request_events(user_id,requested_at);
alter table public.connection_preferences enable row level security;
alter table public.connections enable row level security;
alter table public.connection_blocks enable row level security;
alter table public.connection_request_events enable row level security;
revoke all on public.connection_preferences,public.connections,public.connection_blocks,public.connection_request_events from public,authenticated;
commit;

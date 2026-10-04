-- A directed, owner-only learner relationship.  Unlike the legacy
-- `connections` invitation table, a row means only that source_user chose to
-- keep target_user in their own Connections list.  It never creates a row for
-- the target or sends them a request.
begin;

create table public.profile_connections (
  id uuid not null default gen_random_uuid() unique,
  source_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_user_id, target_user_id),
  check (source_user_id <> target_user_id)
);

create index profile_connections_source_created
  on public.profile_connections(source_user_id, created_at desc, target_user_id);

-- Preserve historical mutual consent as two independent directed choices.
-- Pending, declined, cancelled, and removed invitations intentionally do not
-- become relationships.
insert into public.profile_connections(source_user_id, target_user_id, created_at)
select low_user, high_user, changed_at from public.connections where state = 'accepted'
union all
select high_user, low_user, changed_at from public.connections where state = 'accepted'
on conflict (source_user_id, target_user_id) do nothing;

alter table public.profile_connections enable row level security;
revoke all on public.profile_connections from public, authenticated;
commit;

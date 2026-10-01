-- Backend-only editorial identities. Supabase Auth continues to own credentials.
begin;

create table public.editorial_memberships (
    user_id uuid primary key references auth.users(id) on delete cascade,
    invited_email text not null,
    status text not null default 'active' check (status in ('active', 'revoked')),
    capabilities text[] not null default '{}'
      check (capabilities <@ array['review','approve','publish','request_generation','manage_reviewers']::text[]),
    requested_name text check (length(requested_name) between 2 and 80),
    approved_name text check (length(approved_name) between 2 and 80),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- UUID snapshots intentionally have no cascading user FK: account deletion must
-- not erase the administrative record. Content approval snapshots follow #275.
create table public.editorial_account_events (
    id bigint generated always as identity primary key,
    actor_id uuid not null,
    subject_id uuid not null,
    action text not null check (action in ('bootstrap','invite','profile_requested','profile_approved','access_changed')),
    details jsonb not null default '{}',
    created_at timestamptz not null default now()
);
create index editorial_account_events_subject on public.editorial_account_events(subject_id, id);

alter table public.editorial_memberships enable row level security;
alter table public.editorial_account_events enable row level security;
revoke all on public.editorial_memberships, public.editorial_account_events from public, authenticated;
-- Some disposable PostgreSQL installations do not have the Supabase anon role.
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke all on public.editorial_memberships, public.editorial_account_events from anon;
  end if;
end $$;

commit;

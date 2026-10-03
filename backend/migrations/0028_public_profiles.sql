-- Public sharing is an explicit opt-in; clients cannot read this table directly.
begin;
create table public.profile_sharing (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    public_token text not null unique check (public_token ~ '^[A-Za-z0-9_-]{43}$'),
    enabled boolean not null default false,
    show_name boolean not null default false,
    show_streak boolean not null default false,
    show_learning boolean not null default false,
    achievement_codes text[] not null default '{}',
    version integer not null default 0 check (version >= 0),
    check (cardinality(achievement_codes) <= 32)
);
alter table public.profile_sharing enable row level security;
revoke all on public.profile_sharing from public, authenticated;
-- No direct-user policy: both private writes and filtered public reads use API.
commit;

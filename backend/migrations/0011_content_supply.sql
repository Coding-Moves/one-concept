-- Persistent demand, shared by every reader and generator of a subject.
begin;
create table public.content_supply_targets (
  topic_id uuid primary key references public.topics(id) on delete restrict,
  target_count integer not null check (target_count >= 0),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.content_supply_targets enable row level security;
-- Backend/operator only; no mobile policies.
create index daily_assignments_recent_reader_idx
  on public.daily_assignments (assigned_at, user_id);
commit;

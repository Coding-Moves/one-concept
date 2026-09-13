-- Review is a separate daily activity; unique new-concept assignments stay intact.
begin;
create table public.daily_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete restrict,
  assigned_for date not null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id,assigned_for)
);
create index daily_reviews_rotation_idx on public.daily_reviews(user_id,concept_id,assigned_for desc);
create index daily_reviews_streak_idx on public.daily_reviews(user_id,assigned_for)
  where completed_at is not null;
alter table public.daily_reviews enable row level security;
-- Backend-only writes. No mobile direct access.
commit;

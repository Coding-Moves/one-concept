-- 0001_schema.sql — core schema for One Concept.
-- Applies to a Supabase project (expects the built-in `auth` schema).

begin;

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  -- IANA zone name. Owns every day boundary: assignments, streaks, reminders.
  timezone      text        not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_timezone_not_blank check (length(btrim(timezone)) > 0)
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- topics
create table public.topics (
  id           uuid primary key default gen_random_uuid(),
  slug         text        not null unique,
  name         text        not null,
  description  text,
  is_active    boolean     not null default true,
  sort_order   smallint    not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- concepts
-- Global catalog: one lesson row serves every user.
create table public.concepts (
  id              uuid primary key default gen_random_uuid(),
  topic_id        uuid        not null references public.topics (id) on delete restrict,
  -- Carries the prototype's local ids (e.g. 'hash-tables') so local state can be imported.
  slug            text        not null unique,
  title           text        not null,
  summary         text        not null,
  example         text,
  difficulty      smallint    check (difficulty between 1 and 3),
  status          text        not null default 'published'
                              check (status in ('draft', 'published', 'archived')),
  source          text        not null default 'seed'
                              check (source in ('seed', 'gemini')),
  -- Provenance, so content from a superseded prompt can be found and regenerated.
  model           text,
  prompt_version  text,
  created_at      timestamptz not null default now()
);

create index concepts_pool_idx on public.concepts (topic_id) where status = 'published';

-- ---------------------------------------------------------------- follows
create table public.user_topics (
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  topic_id    uuid        not null references public.topics (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, topic_id)
);

-- ---------------------------------------------------------------- assignments
-- The daily concept, the no-repeat guarantee, and the learning history,
-- all in one table. `completed_at is not null` means "learned".
create table public.daily_assignments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references public.profiles (id) on delete cascade,
  concept_id    uuid        not null references public.concepts (id) on delete restrict,
  -- The user's LOCAL calendar day, stamped at assignment time and never rewritten.
  assigned_for  date        not null,
  assigned_at   timestamptz not null default now(),
  completed_at  timestamptz,

  -- Exactly one concept per user per day.
  constraint daily_assignments_one_per_day unique (user_id, assigned_for),
  -- A concept is never assigned to the same user twice. This constraint IS the
  -- no-repeat requirement: a repeat becomes impossible, not merely unlikely.
  constraint daily_assignments_no_repeat unique (user_id, concept_id)
);

create index assignments_user_day_idx
  on public.daily_assignments (user_id, assigned_for desc);

create index assignments_streak_idx
  on public.daily_assignments (user_id, assigned_for)
  where completed_at is not null;

-- ---------------------------------------------------------------- interactions
-- Likes and saves share a row; the nullable timestamps carry both state and time.
create table public.concept_interactions (
  user_id     uuid        not null references public.profiles (id) on delete cascade,
  concept_id  uuid        not null references public.concepts (id) on delete cascade,
  liked_at    timestamptz,
  saved_at    timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, concept_id)
);

create trigger concept_interactions_touch_updated_at
  before update on public.concept_interactions
  for each row execute function public.touch_updated_at();

create index interactions_saved_idx
  on public.concept_interactions (user_id, saved_at desc) where saved_at is not null;

create index interactions_liked_idx
  on public.concept_interactions (user_id, liked_at desc) where liked_at is not null;

-- ---------------------------------------------------------------- notifications
create table public.notification_preferences (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  enabled         boolean     not null default true,
  reminder_times  time[]      not null default '{08:00, 14:00, 20:00}',
  updated_at      timestamptz not null default now(),
  constraint notification_preferences_max_three
    check (array_length(reminder_times, 1) between 1 and 3)
);

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create table public.device_tokens (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles (id) on delete cascade,
  -- Unique across users: re-registering a handset moves the token to its new owner.
  expo_push_token  text        not null unique,
  platform         text        check (platform in ('ios', 'android')),
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id);

-- ---------------------------------------------------------------- new user
-- A user can never exist without a profile, prefs, and default follows.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Follow every active topic by default, matching the app's current behaviour.
  insert into public.user_topics (user_id, topic_id)
  select new.id, t.id from public.topics t where t.is_active
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;

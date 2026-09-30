-- A completed lesson is a durable learning fact, distinct from the calendar
-- day on which it contributes to a streak.  This lets a learner finish an
-- earlier assigned lesson without backdating daily activity.
begin;

create table public.user_concept_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete restrict,
  source_assignment_id uuid references public.daily_assignments(id) on delete set null,
  completed_at timestamptz not null default now(),
  primary key (user_id, concept_id),
  unique (source_assignment_id)
);

create index user_concept_completions_user_completed_idx
  on public.user_concept_completions(user_id, completed_at desc);
alter table public.user_concept_completions enable row level security;

-- Preserve every completed daily lesson before new writes start using the
-- dedicated table. The assignment timestamp remains the historical learning
-- timestamp rather than the migration execution time.
insert into public.user_concept_completions
  (user_id, concept_id, source_assignment_id, completed_at)
select user_id, concept_id, id, completed_at
  from public.daily_assignments
 where completed_at is not null
on conflict (user_id, concept_id) do nothing;

-- Each row is an immutable fact: this learner completed this exact published
-- set of concepts in this subtopic. A changed catalog receives a new
-- signature, while retries and concurrent devices collide on the same key.
create table public.user_subtopic_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subtopic_id uuid not null references public.subtopics(id) on delete restrict,
  catalog_signature text not null check (catalog_signature ~ '^[0-9a-f]{64}$'),
  catalog_concept_ids uuid[] not null check (cardinality(catalog_concept_ids) > 0),
  completed_at timestamptz not null default now(),
  seen_at timestamptz,
  unique (user_id, subtopic_id, catalog_signature)
);

create index user_subtopic_completions_unseen_idx
  on public.user_subtopic_completions(user_id, completed_at desc)
  where seen_at is null;
alter table public.user_subtopic_completions enable row level security;

commit;

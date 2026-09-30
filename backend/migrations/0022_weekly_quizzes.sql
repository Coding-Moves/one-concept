-- Reviewed MCQs are part of a published lesson version. A weekly quiz is
-- frozen once per learner/week; attempts append results and can never rewrite
-- past answers or scores.
begin;

alter table public.concepts add column mcqs jsonb;

-- Backfill only questions that were generated in the reviewed learning package
-- of the exact version currently published. Seed/legacy lessons stay null.
update public.concepts c
   set mcqs = r.body->'learning_package'->'mcqs'
  from public.concept_revisions r
 where r.concept_id = c.id
   and r.status = 'published'
   and r.base_version = c.content_version - 1
   and jsonb_typeof(r.body->'learning_package'->'mcqs') = 'array';

create table public.weekly_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  questions jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create index weekly_quizzes_owner_week_idx on public.weekly_quizzes(user_id, week_start desc);

create table public.weekly_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.weekly_quizzes(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null,
  correct_count smallint not null check (correct_count between 0 and 7),
  attempted_at timestamptz not null default now()
);
create index weekly_quiz_attempts_history_idx
  on public.weekly_quiz_attempts(user_id, attempted_at desc);

-- A history row is evidence of what the learner saw and submitted. Service-role
-- writes may insert only; correcting an event means adding a later record.
create function public.reject_weekly_quiz_attempt_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'weekly quiz attempts are immutable';
end;
$$;
create trigger weekly_quiz_attempts_immutable
before update or delete on public.weekly_quiz_attempts
for each row execute function public.reject_weekly_quiz_attempt_mutation();

alter table public.weekly_quizzes enable row level security;
alter table public.weekly_quiz_attempts enable row level security;
-- No direct-client policy: FastAPI authenticates and shapes every response,
-- including the correct answer which must never be exposed before submission.
commit;

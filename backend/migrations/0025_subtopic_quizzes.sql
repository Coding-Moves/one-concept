-- A subtopic quiz belongs to one immutable completed catalog. Its reviewed
-- question snapshot stays stable even when the curriculum changes later.
begin;

create table public.subtopic_quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subtopic_completion_id uuid not null references public.user_subtopic_completions(id) on delete restrict,
  questions jsonb not null check (
    case when jsonb_typeof(questions) = 'array'
      then jsonb_array_length(questions) between 1 and 7
      else false
    end
  ),
  created_at timestamptz not null default now(),
  unique (user_id, subtopic_completion_id)
);
create index subtopic_quizzes_owner_created_idx
  on public.subtopic_quizzes(user_id, created_at desc);
alter table public.subtopic_quizzes enable row level security;

-- An attempt is an immutable record of the answer choices submitted against a
-- frozen quiz. Correct answers remain server-only until scoring is complete.
create table public.subtopic_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.subtopic_quizzes(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  correct_count smallint not null check (correct_count between 0 and 7),
  attempted_at timestamptz not null default now()
);
create index subtopic_quiz_attempts_history_idx
  on public.subtopic_quiz_attempts(user_id, attempted_at desc);

create function public.reject_subtopic_quiz_attempt_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'subtopic quiz attempts are immutable';
end;
$$;
create trigger subtopic_quiz_attempts_immutable
before update or delete on public.subtopic_quiz_attempts
for each row execute function public.reject_subtopic_quiz_attempt_mutation();

alter table public.subtopic_quiz_attempts enable row level security;
-- FastAPI is the only writer and withholds answer keys until after submission.
commit;

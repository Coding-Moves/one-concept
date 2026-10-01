begin;
alter table public.notification_preferences
  add column weekly_quiz_enabled boolean not null default false;
alter table public.weekly_quizzes add column notification_queued_at timestamptz;
create table public.weekly_quiz_notifications (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.weekly_quizzes(id) on delete cascade,
  expo_push_token text not null,
  status text not null default 'pending' check(status in
    ('pending','sending','accepted','retry','failed','unknown','skipped')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ticket_id text,
  unique(quiz_id,expo_push_token)
);
create index weekly_quiz_notifications_due on public.weekly_quiz_notifications(next_attempt_at,id)
  where status in ('pending','retry');
alter table public.weekly_quiz_notifications enable row level security;
revoke all on public.weekly_quiz_notifications from public,authenticated;
commit;

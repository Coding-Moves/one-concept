-- 0007_reminder_log.sql — exactly-once bookkeeping for reminder pushes.
--
-- The reminder worker runs every few minutes; this table is what stops a
-- rerun (or an overlapping run) from nagging a user twice for the same slot.
-- Claiming the row happens BEFORE the push is sent: a failed send costs one
-- missed reminder, never a duplicate.

begin;

create table public.reminder_log (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  local_date date not null,
  slot       time not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, local_date, slot)
);

-- Service-role only: no policies on purpose — absence of a policy means denial.
alter table public.reminder_log enable row level security;

commit;

-- Private transactional reviewer notifications. No delivery until enabled by operator.
begin;
alter table public.editorial_memberships add column notification_timezone text not null default 'UTC';
alter table public.concept_revisions add column notification_epoch integer not null default 0;
alter table public.concept_revisions add column review_assigned_at timestamptz;
create table public.editorial_notification_policy (
  singleton boolean primary key default true check(singleton),
  version integer not null default 1,
  deadline_hours integer not null default 48 check(deadline_hours between 1 and 720),
  reminder_hours integer not null default 24 check(reminder_hours between 1 and 168),
  max_reminders integer not null default 2 check(max_reminders between 0 and 10)
);
insert into public.editorial_notification_policy(singleton) values(true);
create table public.editorial_email_batches (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','suppressed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  claim_token uuid,
  failure_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create table public.editorial_email_attempts (
  batch_id uuid not null references public.editorial_email_batches(id),
  attempt integer not null,
  started_at timestamptz not null default now(),
  primary key(batch_id,attempt)
);
create index editorial_email_attempt_time on public.editorial_email_attempts(started_at);
create index editorial_email_ready on public.editorial_email_batches(status,available_at);
create table public.editorial_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.concept_revisions(id) on delete restrict,
  recipient_id uuid not null,
  epoch integer not null,
  ordinal integer not null check(ordinal between 0 and 10),
  created_at timestamptz not null default now(),
  batch_id uuid references public.editorial_email_batches(id) on delete restrict,
  suppressed boolean not null default false,
  unique(revision_id,epoch,ordinal)
);
create index editorial_notification_pending on public.editorial_notification_outbox(created_at)
 where batch_id is null and not suppressed;
-- Capture assignment and entry/reentry into reviewable states in the SAME
-- transaction. draft -> pending_review is the same review cycle, not new mail.
create function public.capture_editorial_notification() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare changed boolean; hours integer;
begin
  changed := TG_OP='INSERT';
  if TG_OP='UPDATE' then
    changed := new.assigned_to is distinct from old.assigned_to
      or new.review_due_at is distinct from old.review_due_at
      or (new.status in ('draft','pending_review')) <> (old.status in ('draft','pending_review'));
  end if;
  if changed then
    new.notification_epoch := coalesce(new.notification_epoch,0)+1;
    if new.assigned_to is not null and new.status in ('draft','pending_review') then
      new.review_assigned_at := statement_timestamp();
      if new.review_due_at is null then
        select deadline_hours into hours from public.editorial_notification_policy;
        new.review_due_at := statement_timestamp() + make_interval(hours=>hours);
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger editorial_notification_cycle before insert or update on public.concept_revisions
 for each row execute function public.capture_editorial_notification();
create function public.enqueue_editorial_notification() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.assigned_to is not null and new.review_assigned_at is not null
     and new.status in ('draft','pending_review') then
    insert into public.editorial_notification_outbox(revision_id,recipient_id,epoch,ordinal)
      values(new.id,new.assigned_to,new.notification_epoch,0) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger editorial_notification_event after insert or update on public.concept_revisions
 for each row execute function public.enqueue_editorial_notification();
-- No retrospective email blast. Existing assignments become eligible only after
-- an owner updates their assignment/deadline; rollout instructions explain this.
alter table public.editorial_account_events drop constraint editorial_account_events_action_check;
alter table public.editorial_account_events add constraint editorial_account_events_action_check
 check(action in ('bootstrap','invite','profile_requested','profile_approved','access_changed',
 'notification_policy','notification_timezone','notification_retry'));
alter table public.editorial_email_attempts enable row level security;
alter table public.editorial_notification_policy enable row level security;
alter table public.editorial_email_batches enable row level security;
alter table public.editorial_notification_outbox enable row level security;
revoke all on public.editorial_notification_policy,public.editorial_email_batches,
 public.editorial_notification_outbox,public.editorial_email_attempts from public,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then
   revoke all on public.editorial_notification_policy,public.editorial_email_batches,
    public.editorial_notification_outbox,public.editorial_email_attempts from anon;
 end if;
end $$;
commit;

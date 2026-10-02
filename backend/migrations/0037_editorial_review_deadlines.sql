-- Owner-assigned review dates; delivery/reminders are a separate worker concern.
begin;
alter table public.concept_revisions add column review_due_at timestamptz;
create index editorial_review_due_idx on public.concept_revisions(review_due_at)
  where status not in ('published','retired');
commit;

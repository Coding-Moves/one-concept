-- Durable claims for bulk correction drafting; no database transaction spans model I/O.
begin;
alter table public.concept_revisions drop constraint concept_revisions_status_check;
alter table public.concept_revisions add constraint concept_revisions_status_check
  check(status in ('generating','draft','published','rejected'));
create index concept_revisions_generating_idx on public.concept_revisions(created_at)
  where status='generating';
commit;

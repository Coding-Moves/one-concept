-- Private bounded operational telemetry; never store request/provider payloads.
begin;
create table public.owner_operation_events (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default clock_timestamp(),
  service text not null check(service in ('api','reminders','pool_topup')),
  code text not null check(code in ('started','completed','failed','database_unavailable','unexpected_failure')),
  severity text not null check(severity in ('info','error')),
  correlation_id uuid not null
);
create index owner_operations_time on public.owner_operation_events(observed_at desc,id desc);
create index owner_operations_service_time on public.owner_operation_events(service,observed_at desc);
create index owner_operations_correlation on public.owner_operation_events(correlation_id);
alter table public.owner_operation_events enable row level security;
revoke all on public.owner_operation_events from public,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='anon') then
  revoke all on public.owner_operation_events from anon;
 end if;
end $$;
create index owner_completion_time on public.user_concept_completions(completed_at,user_id);
create index owner_review_time on public.daily_reviews(completed_at,user_id) where completed_at is not null;
create index owner_registration_time on public.profiles(created_at);
create index owner_evidence_time on public.editorial_revision_events(created_at,id);
create index owner_evidence_actor_time on public.editorial_revision_events(actor_id,created_at);
create index owner_workflow_time on public.editorial_workflow_events(created_at,id);
create index owner_accounts_time on public.editorial_account_events(created_at,id);
commit;

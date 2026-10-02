-- HTTP workflow metadata is private; reviewer evidence and receipts survive
-- account deletion. All writes use authenticated backend transactions.
begin;
alter table public.concept_revisions add column assigned_to uuid;
create table public.editorial_workflow_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid references public.concept_revisions(id) on delete restrict,
  concept_id uuid references public.concepts(id) on delete restrict,
  topic_id uuid references public.topics(id) on delete restrict,
  actor_id uuid not null,
  registered_name text not null,
  action text not null check(action in ('comment','assigned','staged','content_retired','generation_requested')),
  note text not null check(length(btrim(note)) between 10 and 4000),
  details jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index editorial_workflow_events_revision_idx on public.editorial_workflow_events(revision_id,created_at,id);
create index editorial_workflow_events_concept_idx on public.editorial_workflow_events(concept_id,created_at,id);
create table public.editorial_request_receipts (
  actor_id uuid not null,
  request_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,request_id)
);
create trigger editorial_workflow_immutable before update or delete
on public.editorial_workflow_events for each row execute function public.prevent_editorial_evidence_mutation();
create trigger editorial_receipts_immutable before update or delete
on public.editorial_request_receipts for each row execute function public.prevent_editorial_evidence_mutation();
alter table public.editorial_workflow_events enable row level security;
alter table public.editorial_request_receipts enable row level security;
revoke all on public.editorial_workflow_events,public.editorial_request_receipts from public,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on public.editorial_workflow_events,public.editorial_request_receipts from anon;
  end if;
end $$;
commit;

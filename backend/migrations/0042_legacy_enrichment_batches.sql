-- Legacy enrichment is deliberately isolated from the curated backlog and its
-- future-lesson generation jobs. A batch snapshots one existing subject; its
-- entries are immutable evidence of what the editor chose to enrich.
begin;

create table public.editorial_legacy_batches (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete restrict,
  name text not null unique check (name ~ '^[a-z0-9][a-z0-9-]{2,119}$'),
  requested_by uuid not null references public.editorial_memberships(user_id) on delete restrict,
  model text not null,
  prompt_version text not null,
  status text not null default 'queued' check (status in ('queued','running','paused','completed','failed','cancelled')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  quota_limit integer not null check (quota_limit >= 0),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((status in ('running','paused','completed','failed','cancelled')) = (started_at is not null) or status='queued')
);
create unique index editorial_legacy_one_active_topic
  on public.editorial_legacy_batches(topic_id)
  where status in ('queued','running','paused');

create table public.editorial_legacy_batch_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.editorial_legacy_batches(id) on delete restrict,
  concept_id uuid not null references public.concepts(id) on delete restrict,
  base_version integer not null check (base_version > 0),
  source_body jsonb not null,
  status text not null default 'queued' check (status in ('queued','generating','ready_for_review','blocked','failed','published','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  claim_token uuid,
  claimed_at timestamptz,
  result_revision_id uuid unique references public.concept_revisions(id) on delete restrict,
  failure_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(batch_id, concept_id),
  check ((status='generating') = (claim_token is not null and claimed_at is not null)),
  check ((status in ('ready_for_review','published')) = (result_revision_id is not null))
);
create unique index editorial_legacy_active_concept
  on public.editorial_legacy_batch_entries(concept_id)
  where status in ('queued','generating','ready_for_review');
create index editorial_legacy_batch_queue
  on public.editorial_legacy_batch_entries(batch_id,status,created_at);

alter table public.editorial_legacy_batches enable row level security;
alter table public.editorial_legacy_batch_entries enable row level security;
revoke all on public.editorial_legacy_batches, public.editorial_legacy_batch_entries from public, authenticated;
commit;

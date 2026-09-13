-- Curriculum and editorial history are shared catalog data, never user data.
begin;
alter table public.concept_backlog add column curriculum jsonb not null default '{}';
alter table public.concepts
  add column curriculum jsonb not null default '{}',
  add column content_version integer not null default 1 check (content_version >= 0),
  add column published_at timestamptz;
update public.concepts set published_at=created_at where status='published';
create table public.concept_revisions (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concepts(id) on delete restrict,
  base_version integer not null check (base_version >= 0),
  body jsonb not null,
  status text not null default 'draft' check(status in ('draft','published','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
);
create index concept_revisions_pending_idx on public.concept_revisions(concept_id)
  where status='draft';
alter table public.concept_revisions enable row level security;
-- No client policies: drafts, review notes and operator identities stay private.
create table public.content_retry_log (
  id bigint generated always as identity primary key,
  backlog_id uuid not null references public.concept_backlog(id) on delete restrict,
  reason text not null,
  operator text not null,
  created_at timestamptz not null default now()
);
alter table public.content_retry_log enable row level security;
commit;

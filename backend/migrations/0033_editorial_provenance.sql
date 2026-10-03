-- Exact content evidence is private and append-only. Existing free-text operator
-- names are historical notes, never authenticated reviewer attribution.
begin;

alter table public.concept_revisions drop constraint concept_revisions_status_check;
alter table public.concept_revisions add constraint concept_revisions_status_check
  check(status in ('generating','draft','validation_failed','pending_review',
    'changes_requested','approved','rejected','published','retired'));

create table public.editorial_legacy_versions (
  concept_id uuid not null references public.concepts(id) on delete restrict,
  content_version integer not null,
  snapshot jsonb not null,
  inventoried_at timestamptz not null default now(),
  primary key(concept_id, content_version)
);
-- Run once at cutover; there is deliberately no future insert/backfill worker.
insert into public.editorial_legacy_versions(concept_id,content_version,snapshot)
select c.id,c.content_version,to_jsonb(c)-array['created_at','published_at','status']
from public.concepts c where c.status='published';

create table public.editorial_revision_events (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid references public.concept_revisions(id) on delete restrict,
  concept_id uuid not null references public.concepts(id) on delete restrict,
  base_version integer not null check(base_version>=0),
  actor_id uuid not null,
  registered_name text not null check(length(btrim(registered_name))>=2),
  action text not null check(action in ('pending_review','validation_failed',
    'changes_requested','approved','rejected','retired','published','attested')),
  revision_body jsonb not null,
  source_snapshot jsonb not null,
  note text not null check(length(btrim(note))>=10),
  checklist_version integer,
  quality_review jsonb,
  created_at timestamptz not null default clock_timestamp(),
  check ((action in ('approved','attested') and checklist_version is not null and checklist_version=1
    and quality_review is not null) or
    (action not in ('approved','attested') and checklist_version is null
    and quality_review is null)),
  check ((action='attested') = (revision_id is null))
);
create index editorial_revision_events_revision_idx
  on public.editorial_revision_events(revision_id,created_at);
create unique index editorial_revision_events_approval_idx
  on public.editorial_revision_events(revision_id) where action='approved';

create table public.editorial_publications (
  concept_id uuid not null references public.concepts(id) on delete restrict,
  content_version integer not null,
  approval_id uuid not null unique references public.editorial_revision_events(id) on delete restrict,
  snapshot jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(concept_id,content_version)
);

create function public.prevent_editorial_evidence_mutation() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  raise exception 'Editorial evidence is append-only';
end $$;

create trigger editorial_legacy_immutable before update or delete
on public.editorial_legacy_versions for each row
execute function public.prevent_editorial_evidence_mutation();
create trigger editorial_events_immutable before update or delete
on public.editorial_revision_events for each row
execute function public.prevent_editorial_evidence_mutation();
create trigger editorial_publications_immutable before update or delete
on public.editorial_publications for each row
execute function public.prevent_editorial_evidence_mutation();

create function public.protect_reviewed_revision_body() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (new.body,new.concept_id,new.base_version) is distinct from
     (old.body,old.concept_id,old.base_version)
     and exists(select 1 from public.editorial_revision_events where revision_id=old.id) then
    raise exception 'Reviewed revisions are immutable; create a new revision';
  end if;
  return new;
end $$;
create trigger reviewed_revision_body_immutable before update
on public.concept_revisions for each row
execute function public.protect_reviewed_revision_body();

alter table public.editorial_legacy_versions enable row level security;
alter table public.editorial_revision_events enable row level security;
alter table public.editorial_publications enable row level security;
revoke all on public.editorial_legacy_versions,public.editorial_revision_events,
  public.editorial_publications,public.concept_revisions from public,authenticated;
-- Supabase has anon; disposable PostgreSQL fixtures may not.
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    execute 'revoke all on public.editorial_legacy_versions,public.editorial_revision_events,public.editorial_publications,public.concept_revisions from anon';
  end if;
end $$;
commit;

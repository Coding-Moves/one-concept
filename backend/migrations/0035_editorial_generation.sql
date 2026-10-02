-- Durable private AI work. Claims are fenced so an expired worker cannot write
-- after another attempt, cancellation or a newer manual revision.
begin;
alter table public.concept_backlog add column claim_token uuid;
create table public.editorial_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null unique references public.concept_revisions(id) on delete restrict,
  concept_id uuid not null references public.concepts(id) on delete restrict,
  topic_id uuid not null references public.topics(id) on delete restrict,
  feedback_event_id uuid not null references public.editorial_revision_events(id) on delete restrict,
  request_event_id uuid not null references public.editorial_workflow_events(id) on delete restrict,
  requested_by uuid not null,
  source_token text not null,
  source_body jsonb not null,
  feedback text not null,
  status text not null default 'pending' check(status in
    ('pending','generating','failed','ready_for_review','cancelled','superseded')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  claim_token uuid,
  claimed_at timestamptz,
  available_at timestamptz not null default now(),
  result_revision_id uuid unique references public.concept_revisions(id) on delete restrict,
  failure_code text check(failure_code in ('provider_error','rate_limited','invalid_output','stale_claim','requester_inactive')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status='generating') = (claim_token is not null and claimed_at is not null)),
  check ((status='ready_for_review') = (result_revision_id is not null))
);
create unique index editorial_generation_active_concept_idx
  on public.editorial_generation_jobs(concept_id) where status in ('pending','generating');
create index editorial_generation_pending_idx on public.editorial_generation_jobs(available_at,created_at)
  where status in ('pending','generating');

create function public.protect_editorial_job_input() returns trigger
language plpgsql as $$ begin
  if TG_OP='DELETE' then raise exception 'Editorial generation evidence cannot be deleted'; end if;
  if (to_jsonb(new)-array['status','attempts','claim_token','claimed_at','available_at','result_revision_id','failure_code','updated_at'])
     is distinct from
     (to_jsonb(old)-array['status','attempts','claim_token','claimed_at','available_at','result_revision_id','failure_code','updated_at'])
     or (old.result_revision_id is not null and new.result_revision_id is distinct from old.result_revision_id) then
    raise exception 'Editorial generation inputs and results are immutable';
  end if;
  return new;
end $$;
create trigger editorial_generation_inputs_immutable before update or delete
  on public.editorial_generation_jobs for each row execute function public.protect_editorial_job_input();
create function public.protect_generated_revision_body() returns trigger
language plpgsql as $$ begin
  if (new.body,new.base_version,new.concept_id) is distinct from (old.body,old.base_version,old.concept_id)
    and exists(select 1 from public.editorial_generation_jobs
      where source_revision_id=old.id or result_revision_id=old.id) then
    raise exception 'Generated revision evidence is immutable; stage a new revision';
  end if;
  return new;
end $$;
create trigger generated_revision_body_immutable before update on public.concept_revisions
  for each row execute function public.protect_generated_revision_body();
alter table public.editorial_generation_jobs enable row level security;
revoke all on public.editorial_generation_jobs from public,authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on public.editorial_generation_jobs from anon;
  end if;
end $$;
commit;

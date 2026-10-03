-- A cancelled in-flight HTTP request still occupies a shared provider slot.
-- Keep its fenced lease until the worker returns or the bounded lease expires.
begin;
alter table public.editorial_generation_jobs
  drop constraint editorial_generation_jobs_check,
  add constraint editorial_generation_provider_lease_check check (
    (claim_token is null) = (claimed_at is null)
    and (status <> 'generating' or claim_token is not null)
    and (claim_token is null or status in ('generating','cancelled'))
  );
create index editorial_generation_provider_lease_idx
  on public.editorial_generation_jobs(claimed_at) where claim_token is not null;
commit;

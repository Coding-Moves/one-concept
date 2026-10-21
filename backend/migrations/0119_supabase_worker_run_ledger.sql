-- Durable scheduler handoff. The Cron/HTTP transport is installed separately
-- after its Vault secrets are present; every production job starts disabled.
begin;

create table public.edge_worker_jobs (
  name text primary key check (name in (
    'daily_reminders', 'weekly_quiz', 'editorial_email',
    'content_pool', 'editorial_generation', 'legacy_enrichment', 'prefetch'
  )),
  enabled boolean not null default false,
  active_run_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  check ((active_run_id is null) = (lease_until is null))
);

create table public.edge_worker_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null references public.edge_worker_jobs(name),
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in
    ('queued', 'running', 'succeeded', 'failed', 'timed_out')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  request_id bigint,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  unique(job, scheduled_for),
  check (jsonb_typeof(result) = 'object')
);

create index edge_worker_runs_recent on public.edge_worker_runs(job, scheduled_for desc);
create index edge_worker_runs_unfinished on public.edge_worker_runs(queued_at)
  where status in ('queued', 'running');

insert into public.edge_worker_jobs(name) values
  ('daily_reminders'), ('weekly_quiz'), ('editorial_email'),
  ('content_pool'), ('editorial_generation'), ('legacy_enrichment'), ('prefetch');

alter table public.edge_worker_jobs enable row level security;
alter table public.edge_worker_runs enable row level security;
revoke all on public.edge_worker_jobs, public.edge_worker_runs from public, anon, authenticated;
grant select on public.edge_worker_jobs, public.edge_worker_runs to service_role;

create function public.edge_worker_enqueue_run(p_job text, p_scheduled_for timestamptz)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_job is null or p_scheduled_for is null or
     p_scheduled_for < clock_timestamp() - interval '5 minutes' or
     p_scheduled_for > clock_timestamp() + interval '1 minute' then
    raise exception 'Invalid worker schedule';
  end if;
  -- A rerun of the same Cron tick returns the same dispatch identity.
  insert into public.edge_worker_runs(job, scheduled_for)
    values (p_job, p_scheduled_for)
    on conflict (job, scheduled_for) do update
      set scheduled_for = excluded.scheduled_for
    returning id into v_id;
  return v_id;
end
$$;

create function public.edge_worker_start_run(p_id uuid, p_job text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_job public.edge_worker_jobs%rowtype;
declare v_run public.edge_worker_runs%rowtype;
declare v_now timestamptz;
begin
  if p_id is null or p_job is null then return false; end if;
  select * into v_job from public.edge_worker_jobs
    where name = p_job for update;
  if not found or not v_job.enabled then return false; end if;
  select * into v_run from public.edge_worker_runs
    where id = p_id and job = p_job for update;
  v_now := clock_timestamp();
  if not found or v_run.status <> 'queued' or
     v_run.queued_at < v_now - interval '5 minutes' or
     v_run.scheduled_for > v_now + interval '1 minute' then
    return false;
  end if;
  if v_job.active_run_id is not null and v_job.lease_until > v_now then
    return false;
  end if;
  update public.edge_worker_jobs set active_run_id = p_id,
    lease_until = v_now + interval '3 minutes', updated_at = v_now
    where name = p_job;
  update public.edge_worker_runs set status = 'running', started_at = v_now
    where id = p_id;
  return true;
end
$$;

create function public.edge_worker_finish_run(
  p_id uuid, p_success boolean, p_result jsonb default '{}'::jsonb,
  p_error_code text default null
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_job text;
begin
  if p_id is null or p_success is null or p_result is null or
     jsonb_typeof(p_result) <> 'object' or
     octet_length(p_result::text) > 4096 or
     length(coalesce(p_error_code, '')) > 80 then
    raise exception 'Invalid worker result';
  end if;
  select job into v_job from public.edge_worker_runs where id = p_id;
  if v_job is null then return false; end if;
  perform 1 from public.edge_worker_jobs where name = v_job for update;
  if not exists (select 1 from public.edge_worker_jobs
      where name = v_job and active_run_id = p_id) then return false; end if;
  update public.edge_worker_runs set
    status = case when p_success then 'succeeded' else 'failed' end,
    finished_at = clock_timestamp(), result = p_result,
    error_code = case when p_success then null else coalesce(p_error_code, 'worker_error') end
    where id = p_id and status = 'running';
  if not found then return false; end if;
  update public.edge_worker_jobs set active_run_id = null, lease_until = null,
    updated_at = clock_timestamp() where name = v_job and active_run_id = p_id;
  return true;
end
$$;

create function public.edge_worker_expire_runs()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  -- Keep the lock order jobs -> runs, matching start/finish. Clearing an
  -- expired lease fences a late completion before the run is marked timed out.
  update public.edge_worker_jobs j set active_run_id = null,
    lease_until = null, updated_at = clock_timestamp()
    where j.active_run_id is not null and j.lease_until < clock_timestamp();
  update public.edge_worker_runs set status = 'timed_out',
    finished_at = clock_timestamp(), error_code = 'dispatch_timeout'
    where (status = 'queued' and queued_at < clock_timestamp() - interval '5 minutes')
       or (status = 'running' and started_at < clock_timestamp() - interval '4 minutes');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.edge_worker_enqueue_run(text,timestamptz),
  public.edge_worker_start_run(uuid,text),
  public.edge_worker_finish_run(uuid,boolean,jsonb,text),
  public.edge_worker_expire_runs()
  from public, anon, authenticated;
grant execute on function public.edge_worker_enqueue_run(text,timestamptz),
  public.edge_worker_start_run(uuid,text),
  public.edge_worker_finish_run(uuid,boolean,jsonb,text),
  public.edge_worker_expire_runs()
  to service_role;

commit;

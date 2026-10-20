-- Bound durable scheduler history without discarding current or unfinished work.
begin;

create index edge_worker_runs_prune on public.edge_worker_runs(queued_at,id)
  where status in ('succeeded','failed','timed_out');

create or replace function public.edge_worker_expire_runs()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  -- Keep the same jobs -> runs lock order as start/finish.
  update public.edge_worker_jobs j set active_run_id = null,
    lease_until = null, updated_at = clock_timestamp()
    where j.active_run_id is not null and j.lease_until < clock_timestamp();
  update public.edge_worker_runs set status = 'timed_out',
    finished_at = clock_timestamp(), error_code = 'dispatch_timeout'
    where (status = 'queued' and queued_at < clock_timestamp() - interval '5 minutes')
       or (status = 'running' and started_at < clock_timestamp() - interval '4 minutes');
  get diagnostics v_count = row_count;

  -- Reconciliation runs each minute. Prune in small batches to keep locks and
  -- transaction time bounded; recent and unfinished runs are never removed.
  delete from public.edge_worker_runs r where r.id in (
    select id from public.edge_worker_runs
      where queued_at < clock_timestamp() - interval '30 days'
        and status in ('succeeded','failed','timed_out')
      order by queued_at,id limit 1000 for update skip locked
  );
  return v_count;
end
$$;

revoke all on function public.edge_worker_expire_runs()
  from public, anon, authenticated;
grant execute on function public.edge_worker_expire_runs() to service_role;

commit;

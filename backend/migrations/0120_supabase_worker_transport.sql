-- Cron dispatch records an asynchronous HTTP request; the result is checked
-- separately because pg_net queueing does not prove the Edge task ran.
begin;

alter table public.edge_worker_runs add column http_status integer,
  add column http_checked_at timestamptz,
  add column transport_error boolean;

create function public.edge_worker_dispatch(p_job text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  v_enabled boolean;
  v_url text;
  v_key text;
  v_crypto_schema text;
  v_id uuid;
  v_epoch bigint;
  v_message text;
  v_signature text;
  v_request_id bigint;
begin
  select enabled into v_enabled from public.edge_worker_jobs where name = p_job;
  if not coalesce(v_enabled, false) then return null; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'one_concept_worker_url';
  select decrypted_secret into v_key from vault.decrypted_secrets
    where name = 'one_concept_worker_signing_key';
  if v_url is null or v_url !~ '^https://[a-z0-9]{20}[.]supabase[.]co/functions/v1/worker$'
    or v_key is null or length(v_key) < 32 then
    raise exception 'Worker transport secrets are missing or invalid';
  end if;
  select n.nspname into v_crypto_schema from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto';
  if v_crypto_schema is null then
    raise exception 'pgcrypto is required for worker dispatch';
  end if;

  v_id := public.edge_worker_enqueue_run(p_job,
    pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp()));
  -- The run row serializes duplicate calls for the same Cron tick.
  perform 1 from public.edge_worker_runs where id = v_id for update;
  if exists (select 1 from public.edge_worker_runs
      where id = v_id and (status <> 'queued' or request_id is not null)) then
    return null;
  end if;
  v_epoch := pg_catalog.floor(extract(epoch from
    pg_catalog.clock_timestamp()))::bigint;
  v_message := pg_catalog.format(E'v1\n%s\n%s\n%s', v_id, p_job, v_epoch);
  execute pg_catalog.format(
    'select pg_catalog.encode(%I.hmac(pg_catalog.convert_to($1,''UTF8''), pg_catalog.convert_to($2,''UTF8''),''sha256''),''hex'')',
    v_crypto_schema
  ) into v_signature using v_message, v_key;

  -- Never put the service key or signing key in pg_net's readable queue.
  v_request_id := net.http_post(
    url := v_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := pg_catalog.jsonb_build_object(
      'run_id', v_id, 'job', p_job, 'issued_at', v_epoch,
      'signature', v_signature
    ),
    timeout_milliseconds := 90000
  );
  update public.edge_worker_runs set request_id = v_request_id where id = v_id;
  return v_request_id;
end
$$;

create function public.edge_worker_poll_http()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  -- Acquire job locks before run rows, matching start/finish, to avoid a
  -- deadlock if the transport check races a worker completion.
  perform public.edge_worker_expire_runs();
  -- Only status metadata is persisted. The provider/Edge response body may
  -- contain private details and is never copied to our ledger.
  with responses as (
    select r.id, h.status_code, h.timed_out, h.error_msg
      from public.edge_worker_runs r
      join net._http_response h on h.id = r.request_id
     where r.http_checked_at is null
       and r.queued_at > pg_catalog.clock_timestamp() - interval '6 hours'
     order by r.queued_at limit 1000
  )
  update public.edge_worker_runs r set
    http_status = responses.status_code,
    http_checked_at = pg_catalog.clock_timestamp(),
    transport_error = coalesce(responses.timed_out, false)
      or responses.error_msg is not null,
    status = case when r.status in ('queued', 'running') and
      (responses.status_code is null or responses.status_code < 200 or
       responses.status_code >= 300 or coalesce(responses.timed_out, false) or
       responses.error_msg is not null)
      then 'failed' else r.status end,
    finished_at = case when r.status in ('queued', 'running') and
      (responses.status_code is null or responses.status_code < 200 or
       responses.status_code >= 300 or coalesce(responses.timed_out, false) or
       responses.error_msg is not null)
      then pg_catalog.clock_timestamp() else r.finished_at end,
    error_code = case when r.status in ('queued', 'running') and
      (responses.status_code is null or responses.status_code < 200 or
       responses.status_code >= 300 or coalesce(responses.timed_out, false) or
       responses.error_msg is not null)
      then case when responses.status_code is null then 'transport_error'
        else 'http_' || responses.status_code::text end else r.error_code end
    from responses where r.id = responses.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.edge_worker_dispatch(text),
  public.edge_worker_poll_http() from public, anon, authenticated, service_role;

commit;

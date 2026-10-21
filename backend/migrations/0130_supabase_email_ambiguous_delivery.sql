begin;

-- A sending lease may expire after Gmail accepted the message but before the
-- worker recorded its response. Do not automatically send that batch again.
create or replace function public.edge_worker_claim_email(p_daily_cap integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_batch public.editorial_email_batches%rowtype;
declare v_token uuid; v_used integer;
begin
  if p_daily_cap is null or p_daily_cap not between 0 and 500 then
    raise exception 'Invalid editorial email cap';
  end if;
  perform pg_advisory_xact_lock(274,263);
  perform pg_advisory_xact_lock(195,1);
  perform pg_advisory_xact_lock(279,263);
  update public.editorial_email_batches
    set status='failed', failure_code='delivery_unknown',
      claim_token=null, lease_until=null
    where status='sending' and lease_until<now();
  select count(*) into v_used from public.editorial_email_attempts
    where started_at>now()-interval '24 hours';
  if v_used>=p_daily_cap then return null; end if;
  select * into v_batch from public.editorial_email_batches
    where status='pending' and available_at<=now() and attempts<5
    order by available_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  v_token := gen_random_uuid();
  update public.editorial_email_batches set status='sending',
    attempts=attempts+1,claim_token=v_token,
    lease_until=now()+interval '10 minutes' where id=v_batch.id;
  insert into public.editorial_email_attempts(batch_id,attempt)
    values(v_batch.id,v_batch.attempts+1);
  return jsonb_build_object('id',v_batch.id,'claim_token',v_token,
    'attempts',v_batch.attempts+1,'recipient_email',v_batch.recipient_email,
    'subject',v_batch.subject,'body',v_batch.body);
end
$$;

revoke all on function public.edge_worker_claim_email(integer) from public, anon, authenticated;
grant execute on function public.edge_worker_claim_email(integer) to service_role;

commit;

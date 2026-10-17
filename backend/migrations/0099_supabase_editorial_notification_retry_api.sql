-- A failed delivery may be requeued once per durable attempt under owner authority.
begin;

create function public.edge_api_editorial_notification_retry(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_batch_id uuid, p_expected_version integer, p_setup_status text
)
returns jsonb
language plpgsql volatile
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_batch public.editorial_email_batches%rowtype;
begin
  if p_batch_id is null or p_expected_version is null or p_expected_version < 1 then
    return jsonb_build_object('error','invalid');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(274,263);
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  perform pg_catalog.pg_advisory_xact_lock(195,1);
  perform pg_catalog.pg_advisory_xact_lock(279,263);
  if p_setup_status is distinct from 'ready' then
    return jsonb_build_object('error','sender_setup_required');
  end if;
  select * into v_batch from public.editorial_email_batches
    where id=p_batch_id for update;
  if not found then return jsonb_build_object('error','delivery_not_found'); end if;
  if v_batch.attempts <> p_expected_version or v_batch.status <> 'failed'
    or v_batch.attempts >= 5 then
    return jsonb_build_object('error','delivery_conflict');
  end if;
  update public.editorial_email_batches set status='pending',available_at=now()
    where id=p_batch_id;
  insert into public.editorial_account_events(actor_id,subject_id,action,details)
  values(p_user_id,v_batch.recipient_id,'notification_retry',jsonb_build_object(
    'batch_id',p_batch_id::text,'attempts',v_batch.attempts));
  return jsonb_build_object('status','pending');
end
$$;

revoke all on function public.edge_api_editorial_notification_retry(
  uuid,uuid,text,uuid,integer,text
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_notification_retry(
  uuid,uuid,text,uuid,integer,text
) to service_role;

commit;

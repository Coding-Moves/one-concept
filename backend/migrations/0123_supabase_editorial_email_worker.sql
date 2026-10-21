-- Service-only editorial outbox preparation and bounded Gmail claim.
-- Final eligibility and provider I/O must share a direct SQL transaction;
-- the Edge task holds account/catalog/notification locks while sending.
begin;

create function public.edge_worker_email_entry_eligible(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.editorial_notification_outbox o
      join public.concept_revisions r on r.id=o.revision_id
      join public.concepts c on c.id=r.concept_id
      join public.topics t on t.id=c.topic_id
      join public.subtopics s on s.id=c.subtopic_id
      join public.editorial_memberships m on m.user_id=o.recipient_id
      join auth.users u on u.id=m.user_id
     where o.id=p_id and not o.suppressed
       and r.assigned_to=o.recipient_id and r.notification_epoch=o.epoch
       and r.status in ('draft','pending_review')
       and r.base_version=c.content_version and c.status<>'archived'
       and t.is_active and s.is_active and m.status='active'
       and m.approved_name is not null and 'review'=any(m.capabilities)
       and u.email_confirmed_at is not null
       and (u.banned_until is null or u.banned_until<=statement_timestamp())
       and lower(u.email)=lower(m.invited_email)
  );
$$;

create function public.edge_worker_email_batch_eligible(p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_expected integer; v_valid integer;
begin
  select count(*) into v_expected from public.editorial_notification_outbox
    where batch_id=p_id;
  if v_expected=0 then return false; end if;
  select count(*) into v_valid from public.editorial_notification_outbox o
    join public.editorial_email_batches b on b.id=o.batch_id
    join auth.users u on u.id=o.recipient_id
   where o.batch_id=p_id and o.recipient_id=b.recipient_id
     and u.email=b.recipient_email
     and public.edge_worker_email_entry_eligible(o.id);
  return v_valid=v_expected;
end
$$;

create function public.edge_worker_prepare_email(
  p_production boolean, p_recipients text[], p_dashboard_origin text,
  p_limit integer default 10
)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare
  v_recipient record;
  v_item record;
  v_ids uuid[];
  v_body text;
  v_batch uuid;
  v_count integer := 0;
begin
  if p_production is null or p_recipients is null or
     p_dashboard_origin is null or length(p_dashboard_origin)>512 or
     p_dashboard_origin !~ '^https://[^/?#]+$' or
     p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Invalid editorial mail preparation settings';
  end if;
  perform pg_advisory_xact_lock(274,263);
  perform pg_advisory_xact_lock(195,1);
  perform pg_advisory_xact_lock(279,263);

  insert into public.editorial_notification_outbox(
    revision_id,recipient_id,epoch,ordinal)
    select r.id,r.assigned_to,r.notification_epoch,
      least(p.max_reminders,floor(extract(epoch from (now()-r.review_assigned_at))
        /3600/p.reminder_hours)::integer)
      from public.concept_revisions r
      cross join public.editorial_notification_policy p
     where r.assigned_to is not null and r.status in ('draft','pending_review')
       and p.max_reminders>0
       and r.review_assigned_at<=now()+make_interval(hours=>-p.reminder_hours)
    on conflict do nothing;

  update public.editorial_notification_outbox o set suppressed=true
    where not o.suppressed and o.batch_id is null
      and not public.edge_worker_email_entry_eligible(o.id);

  for v_recipient in
    select o.recipient_id,u.email,m.notification_timezone
      from public.editorial_notification_outbox o
      join public.editorial_memberships m on m.user_id=o.recipient_id
      join auth.users u on u.id=m.user_id
     where o.batch_id is null and not o.suppressed
       and o.created_at<=now()-interval '5 minutes'
       and public.edge_worker_email_entry_eligible(o.id)
       and (p_production or lower(u.email)=any(p_recipients))
       and not exists (
         select 1 from public.editorial_notification_outbox newer
          where newer.revision_id=o.revision_id and newer.epoch=o.epoch
            and not newer.suppressed and newer.batch_id is null
            and newer.ordinal>o.ordinal)
     group by o.recipient_id,u.email,m.notification_timezone
     order by o.recipient_id limit p_limit
  loop
    v_ids := '{}'::uuid[];
    v_body := '';
    for v_item in
      select picked.id,picked.revision_id,picked.ordinal,
        r.review_due_at,t.name as topic_name
        from (
          select distinct on (o.revision_id)
            o.id,o.revision_id,o.ordinal
            from public.editorial_notification_outbox o
           where o.recipient_id=v_recipient.recipient_id
             and o.batch_id is null and not o.suppressed
             and o.created_at<=now()-interval '5 minutes'
             and public.edge_worker_email_entry_eligible(o.id)
             and not exists (
               select 1 from public.editorial_notification_outbox newer
                where newer.revision_id=o.revision_id and newer.epoch=o.epoch
                  and not newer.suppressed and newer.batch_id is null
                  and newer.ordinal>o.ordinal)
           order by o.revision_id,o.ordinal desc
        ) picked
        join public.concept_revisions r on r.id=picked.revision_id
        join public.concepts c on c.id=r.concept_id
        join public.topics t on t.id=c.topic_id
       order by picked.revision_id limit 25
    loop
      v_ids := array_append(v_ids,v_item.id);
      v_body := v_body || 'Topic: ' || v_item.topic_name || ' | Due: ' ||
        case when v_item.review_due_at is null then 'No deadline'
          else to_char(v_item.review_due_at at time zone
            v_recipient.notification_timezone,'YYYY-MM-DD HH24:MI') ||
            ' ' || v_recipient.notification_timezone end || E'\n' ||
        p_dashboard_origin || '/?view=review&kind=revisions&id=' ||
        v_item.revision_id::text || E'\n\n';
    end loop;
    if cardinality(v_ids)=0 then continue; end if;
    v_body := 'You have ' || cardinality(v_ids)::text ||
      E' assigned lesson(s) ready for review.\n\n' || v_body ||
      'Sign in with your invited account and authenticator. Review and approval happen only in the workspace.';
    insert into public.editorial_email_batches(
      recipient_id,recipient_email,subject,body)
      values(v_recipient.recipient_id,v_recipient.email,
        'One Concept: assigned lessons to review',v_body)
      returning id into v_batch;
    update public.editorial_notification_outbox set batch_id=v_batch
      where id=any(v_ids);
    update public.editorial_notification_outbox o set suppressed=true
      from public.editorial_notification_outbox chosen
      where chosen.id=any(v_ids) and o.batch_id is null
        and o.revision_id=chosen.revision_id and o.epoch=chosen.epoch
        and o.ordinal<chosen.ordinal;
    v_count := v_count+1;
  end loop;
  return v_count;
end
$$;

create function public.edge_worker_claim_email(p_daily_cap integer)
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
  update public.editorial_email_batches set status='failed',
    failure_code='attempts_exhausted'
    where status='sending' and lease_until<now() and attempts>=5;
  select count(*) into v_used from public.editorial_email_attempts
    where started_at>now()-interval '24 hours';
  if v_used>=p_daily_cap then return null; end if;
  select * into v_batch from public.editorial_email_batches
    where attempts<5 and ((status='pending' and available_at<=now())
      or (status='sending' and lease_until<now()))
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

revoke all on function public.edge_worker_email_entry_eligible(uuid),
  public.edge_worker_email_batch_eligible(uuid),
  public.edge_worker_prepare_email(boolean,text[],text,integer),
  public.edge_worker_claim_email(integer) from public, anon, authenticated;
grant execute on function public.edge_worker_email_entry_eligible(uuid),
  public.edge_worker_email_batch_eligible(uuid),
  public.edge_worker_prepare_email(boolean,text[],text,integer),
  public.edge_worker_claim_email(integer) to service_role;

commit;

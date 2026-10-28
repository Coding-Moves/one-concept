-- Match assignment email copy to the optional reviewer authenticator setting.
begin;

create or replace function public.edge_worker_prepare_email(
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
      'Sign in with your account. If you enabled an authenticator requirement, verify it there. Review and approval happen only in the workspace.';
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

commit;

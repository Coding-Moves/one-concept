-- Owner-only delivery overview returns bounded visible batches and aggregate counts.
begin;

create function public.edge_api_editorial_notifications_overview(
  p_user_id uuid, p_session_id uuid, p_aal text,
  p_cursor uuid, p_limit integer, p_setup_status text, p_daily_cap integer
)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_items jsonb;
  v_next uuid;
  v_counts jsonb;
  v_policy jsonb;
  v_overdue bigint;
  v_used bigint;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_daily_cap is null or p_daily_cap < 0 or p_daily_cap > 500
    or p_setup_status is null or p_setup_status not in (
      'disabled','dashboard_setup_required','sender_setup_required',
      'test_recipients_required','ready') then
    return jsonb_build_object('error','invalid_page');
  end if;
  v_actor := public.edge_api_editorial_authorize(
    p_user_id,p_session_id,p_aal,'manage_reviewers');
  if v_actor ? 'error' then return v_actor; end if;
  with page as (
    select b.id,jsonb_build_object(
      'id',b.id,'recipient_id',b.recipient_id,'status',b.status,
      'attempts',b.attempts,'failure_code',b.failure_code,
      'created_at',public.edge_api_editorial_utc_iso(b.created_at),
      'sent_at',public.edge_api_editorial_utc_iso(b.sent_at),
      'recipient_name',m.approved_name) as item
    from public.editorial_email_batches b
    left join public.editorial_memberships m on m.user_id=b.recipient_id
    where p_cursor is null or b.id>p_cursor
    order by b.id limit p_limit+1
  ), numbered as (
    select page.*,row_number() over(order by id) as position from page
  )
  select coalesce(jsonb_agg(item order by id) filter(where position<=p_limit),'[]'::jsonb),
    (select id from numbered where position=p_limit
      and exists(select 1 from numbered where position>p_limit))
    into v_items,v_next from numbered;
  select coalesce(jsonb_object_agg(s.status,s.total),'{}'::jsonb) into v_counts
    from (select status,count(*)::bigint as total
      from public.editorial_email_batches group by status) s;
  select to_jsonb(p) into v_policy from public.editorial_notification_policy p
    where singleton;
  select count(*) into v_overdue
    from public.concept_revisions r join public.concepts c on c.id=r.concept_id
    where r.status in ('draft','pending_review')
      and r.review_due_at<now() and r.base_version=c.content_version
      and c.status<>'archived';
  select count(*) into v_used from public.editorial_email_attempts
    where started_at>now()-interval '24 hours';
  return jsonb_build_object(
    'policy',v_policy,'setup_status',p_setup_status,'daily_cap',p_daily_cap,
    'attempts_last_24h',v_used,'overdue',v_overdue,'counts',v_counts,
    'items',v_items,'next_cursor',v_next);
end
$$;

revoke all on function public.edge_api_editorial_notifications_overview(
  uuid,uuid,text,uuid,integer,text,integer
) from public, anon, authenticated;
grant execute on function public.edge_api_editorial_notifications_overview(
  uuid,uuid,text,uuid,integer,text,integer
) to service_role;

commit;

-- Read-only operator snapshot. Run in the target project's SQL Editor with an
-- operator account; this prints counts and run metadata, never recipient data.
select j.name as job, j.enabled as application_enabled,
       c.schedule, c.active as cron_active,
       r.scheduled_for as last_tick, r.status as last_result,
       r.http_status, r.error_code,
       r.finished_at as last_finished_at
  from public.edge_worker_jobs j
  left join cron.job c on c.jobname='one-concept-' || j.name
  left join lateral (
    select scheduled_for,status,http_status,error_code,finished_at
      from public.edge_worker_runs r
     where r.job=j.name order by scheduled_for desc limit 1
  ) r on true
 order by j.name;

select job,
       count(*) filter (where status='succeeded') as succeeded_24h,
       count(*) filter (where status in ('failed','timed_out')) as failed_24h,
       count(*) filter (where status in ('queued','running')) as unfinished_24h,
       max(finished_at) filter (where status='succeeded') as last_success
  from public.edge_worker_runs
 where scheduled_for >= now()-interval '24 hours'
 group by job order by job;

select 'daily_reminder' as queue, status, count(*) as items
  from public.daily_reminder_outbox group by status
union all
select 'weekly_quiz', status, count(*)
  from public.weekly_quiz_notifications group by status
union all
select 'reviewer_email', status, count(*)
  from public.editorial_email_batches group by status
union all
select 'editorial_generation', status, count(*)
  from public.editorial_generation_jobs group by status
union all
select 'legacy_enrichment', status, count(*)
  from public.editorial_legacy_batch_entries group by status
union all
select 'curated_backlog', status, count(*)
  from public.concept_backlog group by status
order by queue,status;

select budget_day,calls_used from public.generation_daily_usage
 where budget_day >= (now() at time zone 'America/Los_Angeles')::date-1
 order by budget_day desc;

select j.jobname,d.status,count(*) as runs,
       max(d.end_time) as latest_finished_at
  from cron.job_run_details d join cron.job j on j.jobid=d.jobid
 where j.jobname like 'one-concept-%'
   and d.start_time >= now()-interval '24 hours'
 group by j.jobname,d.status order by j.jobname,d.status;

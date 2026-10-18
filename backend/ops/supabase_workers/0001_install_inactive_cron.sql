-- Apply after migrations 0119 and 0120 on a Supabase project. This file is
-- intentionally separate from the portable schema migrations: pg_cron and
-- pg_net are platform extensions unavailable in disposable plain PostgreSQL.
-- Every job is deactivated before this transaction commits.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $install$
declare
  item record;
  installed_job bigint;
begin
  for item in select * from (values
    ('daily_reminders', '*/1 * * * *'),
    ('weekly_quiz', '* * * * *'),
    ('editorial_email', '4,19,34,49 * * * *'),
    ('editorial_generation', '0 22 * * *'),
    ('legacy_enrichment', '5 22 * * *'),
    ('content_pool', '*/5 * * * *'),
    ('prefetch', '2-59/5 * * * *')
  ) as schedules(job, expression) loop
    installed_job := cron.schedule(
      'one-concept-' || item.job,
      item.expression,
      format('select public.edge_worker_dispatch(%L)', item.job)
    );
    perform cron.alter_job(installed_job, active := false);
  end loop;

  installed_job := cron.schedule(
    'one-concept-http-reconcile', '* * * * *',
    'select public.edge_worker_poll_http()'
  );
  perform cron.alter_job(installed_job, active := false);
end
$install$;

-- Fail the transaction if any name is missing or active. pg_cron does not
-- expose the HTTP result as a Cron result; the poll job fills the run ledger.
do $verify$
begin
  if (select count(*) from cron.job
      where jobname like 'one-concept-%') <> 8 or
     exists (select 1 from cron.job
       where jobname like 'one-concept-%' and active) then
    raise exception 'One Concept Cron jobs were not installed inactive';
  end if;
end
$verify$;

commit;

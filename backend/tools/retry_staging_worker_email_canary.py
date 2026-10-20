"""Retry only the staging email batch rejected before Gmail granted access.

The prior batch keeps its stable Message-ID. A retry is permitted only for a
single OAuth authorization failure, which happened before Gmail could send.
"""

import os
import re
import subprocess
import sys

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
    from .prepare_staging_worker_canaries import literal
    from .run_staging_worker_canary import run
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
    from prepare_staging_worker_canaries import literal
    from run_staging_worker_canary import run


def retry_sql(reviewer: str) -> str:
    address = literal(reviewer)
    return f"""begin;
do $email_retry$
declare v_ids uuid[]; v_id uuid;
begin
  perform pg_advisory_xact_lock(274,263);
  perform pg_advisory_xact_lock(195,1);
  perform pg_advisory_xact_lock(279,263);
  if exists(select 1 from cron.job where jobname like 'one-concept-%' and active)
     or exists(select 1 from public.edge_worker_jobs where enabled)
     or exists(select 1 from public.editorial_email_batches
       where status in ('pending','sending')) then
    raise exception 'Email retry staging queues are not idle';
  end if;
  select array_agg(b.id) into v_ids
    from public.editorial_email_batches b
   where b.status='failed' and b.failure_code='sender_authorization'
     and b.attempts=1 and b.sent_at is null
     and b.created_at>=clock_timestamp()-interval '4 hours'
     and lower(b.recipient_email)=lower({address})
     and exists(select 1 from public.editorial_notification_outbox o
       join public.concept_revisions r on r.id=o.revision_id
       join public.concepts c on c.id=r.concept_id
       where o.batch_id=b.id and not o.suppressed
         and c.slug like 'staging-worker-email-%');
  if coalesce(cardinality(v_ids),0)<>1 then
    raise exception 'Email retry does not match one unsent staging canary';
  end if;
  v_id := v_ids[1];
  if not public.edge_worker_email_batch_eligible(v_id)
     or (select count(*) from public.editorial_email_attempts
           where started_at>clock_timestamp()-interval '24 hours')<>1
     or not exists(select 1 from public.editorial_email_attempts
           where batch_id=v_id and attempt=1) then
    raise exception 'Email retry does not match one unsent staging canary';
  end if;
  update public.editorial_email_batches
     set status='pending',failure_code=null,available_at=clock_timestamp()
   where id=v_id and status='failed' and failure_code='sender_authorization';
  if not found then raise exception 'Email retry batch changed'; end if;
end
$email_retry$;
commit;"""


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    reviewer = os.environ.get("STAGING_CANARY_REVIEWER_EMAIL", "").strip()
    if staging != DEMO_PROJECT_REF or \
       not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", reviewer):
        print("Email retry refused: unreviewed staging target or recipient", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production, os.environ["STAGING_DIRECT_URL"])
        sql = retry_sql(reviewer)
    except (KeyError, ValueError):
        print("Email retry refused: invalid staging connection", file=sys.stderr)
        return 2
    result = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
                            input=sql, env=env, text=True, capture_output=True,
                            timeout=20, check=False)
    if result.returncode:
        print("Email retry refused: staging batch guard failed", file=sys.stderr)
        return 1
    return run("editorial_email")


if __name__ == "__main__":
    raise SystemExit(main())

"""Close staging application gates after a canary, including on failure."""

import os
import re
import subprocess
import sys

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


SQL = """begin;
update public.edge_worker_jobs set enabled=false where enabled;
commit;
begin;
"""
VERIFY = """commit;
do $$ begin
  if exists(select 1 from cron.job
      where jobname like 'one-concept-%' and active) then
    raise exception 'A staging Cron schedule is unexpectedly active';
  end if;
end $$;
"""


def cleanup_sql(token: str, reviewer: str) -> str:
    cleanup = """update public.editorial_generation_jobs
  set status='cancelled',claim_token=null,claimed_at=null,updated_at=clock_timestamp()
  where source_body->>'title'='Staging worker canary: transactions'
    and status in ('pending','generating');
update public.editorial_notification_outbox o set suppressed=true
  from public.concept_revisions r join public.concepts c on c.id=r.concept_id
  where o.revision_id=r.id and c.slug like 'staging-worker-email-%'
    and o.batch_id is null and not o.suppressed;
"""
    if re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", reviewer):
        quoted_email = "'" + reviewer.replace("'", "''") + "'"
        cleanup += f"""update public.editorial_email_batches set status='failed',
  lease_until=null,claim_token=null,failure_code='staging_canary_closed'
  where subject='One Concept: assigned lessons to review'
    and created_at>=clock_timestamp()-interval '2 hours'
    and status in ('pending','sending')
    and lower(recipient_email)=lower({quoted_email});
"""
    if not re.fullmatch(r"(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,160}\]", token):
        return SQL + cleanup + VERIFY
    quoted = "'" + token + "'"
    return SQL + cleanup + f"""delete from public.daily_reminder_outbox
  where expo_push_token={quoted};
delete from public.weekly_quiz_notifications where expo_push_token={quoted};
delete from public.weekly_quizzes q using public.device_tokens d
  where q.user_id=d.user_id and d.expo_push_token={quoted}
    and q.questions='[]'::jsonb and q.notification_queued_at is not null
    and not exists(select 1 from public.weekly_quiz_attempts a where a.quiz_id=q.id);
delete from public.device_tokens where expo_push_token={quoted};
""" + VERIFY


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    if staging != DEMO_PROJECT_REF or staging == production:
        print("Staging gate closure refused: unreviewed target", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production, os.environ["STAGING_DIRECT_URL"])
    except (KeyError, ValueError):
        print("Staging gate closure refused: invalid connection", file=sys.stderr)
        return 2
    result = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
                            input=cleanup_sql(os.environ.get("STAGING_CANARY_PUSH_TOKEN", ""),
                                              os.environ.get("STAGING_CANARY_REVIEWER_EMAIL", "")),
                            env=env, text=True, capture_output=True,
                            timeout=20, check=False)
    if result.returncode:
        print("Could not verify inactive staging worker gates", file=sys.stderr)
        return 1
    print("All staging worker gates are closed; test phone token removed if present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

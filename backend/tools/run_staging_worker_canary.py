"""Dispatch one pre-seeded staging worker canary with all Cron schedules inactive.

Provider credentials and allowlists are configured separately in the protected
staging environment. This tool prints only the job name and bounded counters.
"""

import argparse
import hashlib
import os
import re
import subprocess
import sys
import time

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


JOBS = {
    "daily_reminders": "accepted",
    "weekly_quiz": "accepted",
    "editorial_email": "sent",
    "editorial_generation": "ready",
}
REQUEST_ID = re.compile(r"[0-9]{1,20}\Z")
GENERATED_TITLE = "Staging worker canary: transactions"


def query(env: dict[str, str], sql: str) -> str | None:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=env, text=True, capture_output=True, timeout=20, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def fixture_is_safe(env: dict[str, str], job: str) -> bool:
    if job in {"daily_reminders", "weekly_quiz"}:
        token = os.environ.get("STAGING_CANARY_PUSH_TOKEN", "").strip()
        if not re.fullmatch(r"(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,160}\]", token):
            return False
        digest = hashlib.sha256(token.encode()).hexdigest()
        token_count = query(env, "select count(*) from public.device_tokens")
        matched = query(env, "select count(*) from public.device_tokens where "
                        "encode(pg_catalog.sha256(convert_to(expo_push_token,'UTF8')),'hex')="
                        f"'{digest}'")
        table = "daily_reminder_outbox" if job == "daily_reminders" \
            else "weekly_quiz_notifications"
        pending = query(env, f"select count(*) from public.{table} where status='pending'")
        return token_count == matched == pending == "1"
    if job == "editorial_email":
        recipient = os.environ.get("STAGING_CANARY_REVIEWER_EMAIL", "").strip().lower()
        if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", recipient):
            return False
        digest = hashlib.sha256(recipient.encode()).hexdigest()
        ready = query(env, "select count(*) from public.editorial_notification_outbox "
                      "o join auth.users u on u.id=o.recipient_id "
                      "where o.batch_id is null and not o.suppressed "
                      "and o.created_at<=now()-interval '5 minutes' "
                      "and public.edge_worker_email_entry_eligible(o.id) "
                      "and encode(pg_catalog.sha256(convert_to(lower(u.email),'UTF8')),'hex')="
                      f"'{digest}'")
        other_batches = query(env, "select count(*) from public.editorial_email_batches "
                              "where status in ('pending','sending')")
        return ready == "1" and other_batches == "0"
    if job == "editorial_generation":
        pending = query(env, "select count(*) from public.editorial_generation_jobs "
                        "where status='pending'")
        named = query(env, "select count(*) from public.editorial_generation_jobs "
                      "where status='pending' and source_body->>'title'="
                      f"'{GENERATED_TITLE}'")
        return pending == named == "1"
    return False


def run(job: str) -> int:
    if job not in JOBS:
        print("Worker canary refused: unsupported job", file=sys.stderr)
        return 2
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    if staging != DEMO_PROJECT_REF or staging == production:
        print("Worker canary refused: unreviewed staging target", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production,
                                     os.environ["STAGING_DIRECT_URL"])
    except (KeyError, ValueError):
        print("Worker canary refused: invalid staging connection", file=sys.stderr)
        return 2
    if query(env, "select count(*) from cron.job where "
             "jobname like 'one-concept-%' and active") != "0" or \
       query(env, "select count(*) from public.edge_worker_jobs where enabled") != "0":
        print("Worker canary refused: a scheduled or application job is active",
              file=sys.stderr)
        return 2
    if not fixture_is_safe(env, job):
        print("Worker canary refused: staging fixture or recipient is unsafe",
              file=sys.stderr)
        return 2
    if query(env, f"update public.edge_worker_jobs set enabled=true "
             f"where name='{job}' returning name") != job:
        print("Worker canary could not open the temporary job gate", file=sys.stderr)
        return 1
    outcome = 1
    try:
        request_id = query(env, f"select public.edge_worker_dispatch('{job}')")
        if request_id is None or not REQUEST_ID.fullmatch(request_id):
            print("Worker canary did not enqueue an HTTP dispatch", file=sys.stderr)
            return 1
        expected = JOBS[job]
        for _ in range(90):
            query(env, "select public.edge_worker_poll_http()")
            row = query(env, "select status,coalesce(http_status,0),"
                        f"coalesce(result->>'{expected}','') "
                        "from public.edge_worker_runs "
                        f"where request_id={request_id}")
            if row == "succeeded|200|1":
                outcome = 0
                break
            if row is not None and row.startswith(("succeeded|", "failed|", "timed_out|")):
                break
            time.sleep(1)
    finally:
        closed = query(env, f"update public.edge_worker_jobs set enabled=false "
                       f"where name='{job}' returning name")
        if closed != job:
            print("Worker canary could not close the temporary job gate",
                  file=sys.stderr)
            outcome = 1
    if outcome:
        print(f"Staging {job} canary did not complete with one {JOBS[job]}",
              file=sys.stderr)
    else:
        print(f"Staging {job} canary completed with one {JOBS[job]}")
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", choices=sorted(JOBS))
    return run(parser.parse_args().job)


if __name__ == "__main__":
    raise SystemExit(main())

"""Exercise the signed staging transport without contacting a provider."""

import os
import re
import subprocess
import sys
import time

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


JOB = "editorial_generation"
REQUEST_ID = re.compile(r"[0-9]{1,20}\Z")
SAFE_FAILURE = re.compile(
    r"(queued|running|succeeded|failed|timed_out)\|([0-9]{1,3})\|"
    r"(started|not_started)\|([a-z][a-z0-9_]{0,79})\|"
    r"(ledger_unavailable|task_failed|run_fenced|job_unavailable|"
    r"run_not_claimed|invalid_dispatch|unrecognized)\Z"
)


def failure_label(env: dict[str, str], request_id: str) -> str:
    # Never print an Edge response body. Match only fixed handler error labels.
    sql = f"""select r.status,coalesce(r.http_status,0),
      case when r.started_at is null then 'not_started' else 'started' end,
      coalesce(r.error_code,'none'),
      case
        when strpos(coalesce(h.content::text,''),'\"error\":\"ledger_unavailable\"')>0
          then 'ledger_unavailable'
        when strpos(coalesce(h.content::text,''),'\"error\":\"task_failed\"')>0
          then 'task_failed'
        when strpos(coalesce(h.content::text,''),'\"error\":\"run_fenced\"')>0
          then 'run_fenced'
        when strpos(coalesce(h.content::text,''),'\"error\":\"job_unavailable\"')>0
          then 'job_unavailable'
        when strpos(coalesce(h.content::text,''),'\"error\":\"run_not_claimed\"')>0
          then 'run_not_claimed'
        when strpos(coalesce(h.content::text,''),'\"error\":\"invalid_dispatch\"')>0
          then 'invalid_dispatch'
        else 'unrecognized' end
      from public.edge_worker_runs r
      left join net._http_response h on h.id=r.request_id
      where r.request_id={request_id}"""
    value = query(env, sql)
    return value if value and SAFE_FAILURE.fullmatch(value) else "unavailable"


def query(env: dict[str, str], sql: str) -> str | None:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=env, text=True, capture_output=True, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    if staging != DEMO_PROJECT_REF or staging == production:
        print("Worker smoke refused: unreviewed staging target", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production,
                                     os.environ["STAGING_DIRECT_URL"])
    except (KeyError, ValueError):
        print("Worker smoke refused: invalid staging connection", file=sys.stderr)
        return 2
    active = query(env, "select count(*) from cron.job where "
                   "jobname like 'one-concept-%' and active")
    enabled = query(env, "select enabled from public.edge_worker_jobs "
                    f"where name='{JOB}'")
    if active != "0" or enabled != "f":
        print("Worker smoke refused: scheduled or application job is active",
              file=sys.stderr)
        return 2
    if query(env, f"update public.edge_worker_jobs set enabled=true "
              f"where name='{JOB}' returning name") != JOB:
        print("Worker smoke could not open the temporary job gate", file=sys.stderr)
        return 1
    outcome = 1
    try:
        request_id = query(env, f"select public.edge_worker_dispatch('{JOB}')")
        if request_id is None or not REQUEST_ID.fullmatch(request_id):
            print("Worker smoke did not enqueue an HTTP dispatch", file=sys.stderr)
            return 1
        for _ in range(60):
            query(env, "select public.edge_worker_poll_http()")
            row = query(env, "select status,coalesce(http_status,0),"
                        "coalesce(result->>'disabled','') "
                        "from public.edge_worker_runs "
                        f"where request_id={request_id}")
            if row == "succeeded|200|1":
                outcome = 0
                break
            if row is not None and row.startswith(("failed|", "timed_out|")):
                break
            time.sleep(1)
    finally:
        closed = query(env, f"update public.edge_worker_jobs set enabled=false "
                       f"where name='{JOB}' returning name")
        if closed != JOB:
            print("Worker smoke could not close the temporary job gate",
                  file=sys.stderr)
            outcome = 1
    if outcome:
        print("Signed staging worker dispatch did not complete: " +
              failure_label(env, request_id), file=sys.stderr)
    else:
        print("Signed staging dispatch completed with generation disabled")
    return outcome


if __name__ == "__main__":
    raise SystemExit(main())

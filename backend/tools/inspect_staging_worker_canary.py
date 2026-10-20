"""Read only the bounded failure state of the staging email canary.

The protected GitHub environment supplies the staging connection. Never print
database rows, recipient addresses, provider responses, or connection details.
"""

import os
import re
import subprocess
import sys

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


SAFE_CODE = re.compile(r"[a-z][a-z0-9_]{0,79}\Z")
SAFE_STATUS = {"pending", "sending", "sent", "failed", "suppressed",
               "queued", "running", "succeeded", "timed_out"}


def safe_code(value: str) -> str:
    return value if SAFE_CODE.fullmatch(value) else "unrecognized"


def read_row(env: dict[str, str], sql: str, fields: int) -> list[str] | None:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=env, capture_output=True, text=True, timeout=20, check=False,
    )
    if result.returncode:
        raise ValueError("staging diagnostic query failed")
    if not result.stdout.strip():
        return None
    rows = result.stdout.strip().splitlines()
    if len(rows) != 1:
        raise ValueError("staging diagnostic returned multiple rows")
    cells = rows[0].split("|")
    if len(cells) != fields:
        raise ValueError("staging diagnostic returned an unexpected shape")
    return cells


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    if staging != DEMO_PROJECT_REF:
        print("Staging diagnostic refused: unreviewed target", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production, os.environ["STAGING_DIRECT_URL"])
        run = read_row(env, """select status,coalesce(http_status,0),
          coalesce(error_code,'none'),coalesce(result->>'prepared','0'),
          coalesce(result->>'claimed','0'),coalesce(result->>'sent','0'),
          coalesce(result->>'pending','0'),coalesce(result->>'failed','0'),
          coalesce(result->>'suppressed','0')
          from public.edge_worker_runs where job='editorial_email'
          order by queued_at desc,id desc limit 1""", 9)
        batch = read_row(env, """select status,attempts,coalesce(failure_code,'none')
          from public.editorial_email_batches
          where subject='One Concept: assigned lessons to review'
          order by created_at desc,id desc limit 1""", 3)
    except (KeyError, ValueError, subprocess.TimeoutExpired):
        print("Staging email diagnostic could not complete", file=sys.stderr)
        return 1
    if run is None:
        print("Staging editorial email: no run")
    elif run[0] not in SAFE_STATUS or any(not field.isdecimal() for field in (run[1], *run[3:])):
        print("Staging email diagnostic returned invalid run metadata", file=sys.stderr)
        return 1
    else:
        print("Staging editorial email run: status=" + run[0] +
              " http=" + run[1] + " error=" + safe_code(run[2]) +
              " prepared=" + run[3] + " claimed=" + run[4] +
              " sent=" + run[5] + " pending=" + run[6] +
              " failed=" + run[7] + " suppressed=" + run[8])
    if batch is None:
        print("Staging editorial email: no batch")
    elif batch[0] not in SAFE_STATUS or not batch[1].isdecimal():
        print("Staging email diagnostic returned invalid batch metadata", file=sys.stderr)
        return 1
    else:
        print("Staging editorial email batch: status=" + batch[0] +
              " attempts=" + batch[1] + " failure=" + safe_code(batch[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

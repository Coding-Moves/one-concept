"""Install the reviewed worker Cron names inactive in the fixed staging project."""

import os
import sys
from pathlib import Path

try:
    from .apply_staging_migrations import (
        DEMO_PROJECT_REF, connection_environment, function_presence, psql,
    )
except ImportError:
    from apply_staging_migrations import (
        DEMO_PROJECT_REF, connection_environment, function_presence, psql,
    )


SCRIPT = Path(__file__).resolve().parents[1] / "ops/supabase_workers/0001_install_inactive_cron.sql"
REQUIRED = (
    "public.edge_worker_dispatch(text)",
    "public.edge_worker_poll_http()",
    "public.edge_worker_claim_email(integer)",
)


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    if staging != DEMO_PROJECT_REF or staging == production:
        print("Worker Cron installation refused: unreviewed staging target", file=sys.stderr)
        return 2
    try:
        env = connection_environment(staging, production, os.environ["STAGING_DIRECT_URL"])
    except (KeyError, ValueError):
        print("Worker Cron installation refused: invalid staging connection", file=sys.stderr)
        return 2
    if function_presence(env, REQUIRED) != (True,) * len(REQUIRED):
        print("Worker Cron installation refused: worker schema is incomplete", file=sys.stderr)
        return 2
    result = psql(env, "-q", "-f", str(SCRIPT))
    if result.returncode != 0:
        print("Inactive worker Cron installation failed", file=sys.stderr)
        print(result.stderr[-1000:], file=sys.stderr)
        return 1
    print("Installed and verified eight inactive staging worker Cron jobs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

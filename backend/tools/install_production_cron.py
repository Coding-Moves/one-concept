"""Install the reviewed One Concept production Cron jobs inactive, once."""

import argparse
from pathlib import Path

from .apply_production_cutover import target_environment
from .apply_staging_migrations import psql


INSTALLER = Path(__file__).resolve().parents[1] / "ops/supabase_workers/0001_install_inactive_cron.sql"
WORKER_SCHEMA = """
select to_regprocedure('public.edge_worker_dispatch(text)') is not null
   and to_regprocedure('public.edge_worker_poll_http()') is not null
"""
EXPECTED_JOBS = (
    "one-concept-content_pool",
    "one-concept-daily_reminders",
    "one-concept-editorial_email",
    "one-concept-editorial_generation",
    "one-concept-http-reconcile",
    "one-concept-legacy_enrichment",
    "one-concept-prefetch",
    "one-concept-weekly_quiz",
)


def query_is_true(env: dict[str, str], query: str) -> bool:
    result = psql(env, "-qAt", "-c", query)
    return result.returncode == 0 and result.stdout.strip() == "t"


def installed_inactive(env: dict[str, str]) -> bool:
    names = ", ".join("'" + name + "'" for name in EXPECTED_JOBS)
    return query_is_true(env, f"""
        select count(*) = {len(EXPECTED_JOBS)}
           and count(*) filter (where active) = 0
           and array_agg(jobname order by jobname) = array[{names}]::text[]
        from cron.job where jobname like 'one-concept-%'
    """)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    try:
        env = target_environment()
    except ValueError:
        print("production_cron_target=invalid")
        return 2
    if not query_is_true(env, WORKER_SCHEMA):
        print("production_worker_schema=missing")
        return 2
    print("production_worker_schema=ready")
    if not args.install:
        return 0
    result = psql(env, "-q", "-f", str(INSTALLER))
    if result.returncode != 0:
        print("production_cron_install=failed")
        return 1
    if not installed_inactive(env):
        print("production_cron_readback=failed")
        return 1
    print("production_cron_jobs=8_inactive")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

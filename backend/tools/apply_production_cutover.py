"""Apply only reviewed 0046-0130 SQL to the fixed production project.

The caller must have a verified backup. This runner never updates applied.txt:
record filenames only after independent production read-back. It refuses to
resume a partially migrated database; investigate the last successful file.
"""

import argparse
import os
import re
import sys
from pathlib import Path

try:
    from .apply_staging_migrations import connection_environment, psql
except ImportError:
    from apply_staging_migrations import connection_environment, psql


PRODUCTION_REF = "egdszjoesxlccauahmsx"
STAGING_REF = "zhrulokgngjceqgjkcmw"
BASELINE = "0045_editorial_authenticator_choice.sql"
FINAL = "0130_supabase_email_ambiguous_delivery.sql"
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
BACKUP_REFERENCE = re.compile(r"[A-Za-z0-9._:-]{8,80}\Z")


def pending_files() -> list[Path]:
    files = sorted(MIGRATIONS.glob("0*.sql"))
    names = [path.name for path in files]
    if BASELINE not in names or names[-1] != FINAL:
        raise ValueError("The reviewed migration range changed")
    pending = files[names.index(BASELINE) + 1:]
    if len(pending) != 85 or pending[0].name != "0046_supabase_api_basics.sql":
        raise ValueError("The reviewed migration range is incomplete")
    return pending


def target_environment() -> dict[str, str]:
    if (os.environ.get("PRODUCTION_PROJECT_REF") != PRODUCTION_REF or
            os.environ.get("STAGING_PROJECT_REF") != STAGING_REF):
        raise ValueError("Production and staging project references differ from reviewed targets")
    # The staging helper checks the connection's project identity, pooler
    # username, database, TLS, and port. Here its target argument is production.
    env = connection_environment(
        PRODUCTION_REF, STAGING_REF,
        os.environ.get("PRODUCTION_SCHEMA_DIRECT_URL", ""),
    )
    env.pop("PRODUCTION_SCHEMA_DIRECT_URL", None)
    return env


def baseline_ready(env: dict[str, str]) -> bool:
    result = psql(env, "-qAt", "-c", """
        select to_regclass('public.editorial_memberships') is not null
           and to_regclass('public.profiles') is not null
           and to_regprocedure('public.edge_api_health()') is null
           and to_regclass('public.edge_worker_jobs') is null
    """)
    return result.returncode == 0 and result.stdout.strip() == "t"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="read-only target and baseline check")
    group.add_argument("--apply", action="store_true", help="one-time ordered production application")
    args = parser.parse_args()
    try:
        files = pending_files()
        env = target_environment()
    except ValueError:
        print("Production cutover refused: target, connection, or file range invalid", file=sys.stderr)
        return 2
    if not baseline_ready(env):
        print("Production cutover refused: baseline is missing or partly applied", file=sys.stderr)
        return 2
    if args.check:
        print(f"Production target and 0045 baseline verified; pending={len(files)}")
        return 0
    if not BACKUP_REFERENCE.fullmatch(os.environ.get("PRODUCTION_BACKUP_REFERENCE", "")):
        print("Production cutover refused: a recorded backup reference is required", file=sys.stderr)
        return 2
    if os.environ.get("PRODUCTION_APPLY_CONFIRMATION") != f"apply-0046-through-0130-to-{PRODUCTION_REF}":
        print("Production cutover refused: exact apply confirmation is required", file=sys.stderr)
        return 2
    for count, file in enumerate(files, start=1):
        result = psql(env, "-q", "-f", str(file))
        if result.returncode != 0:
            print(f"Production cutover stopped at {file.name}; completed={count-1}; inspect before any retry", file=sys.stderr)
            return 1
        print(f"Applied {file.name}", flush=True)
    result = psql(env, "-q", "-c", "NOTIFY pgrst, 'reload schema'")
    if result.returncode != 0:
        print("Production SQL applied; PostgREST reload failed; inspect before proceeding", file=sys.stderr)
        return 1
    print("Production SQL 0046-0130 applied; independent verification and ledger update remain")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

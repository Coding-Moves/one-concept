"""Apply the ordered repository migrations to a fresh, explicitly named staging project.

Supply the connection URL through STAGING_DIRECT_URL in the process environment.
Never pass it as a CLI argument, save it in the repository, or log it.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
INSPECT_SQL = """select json_build_object(
  'auth_users', to_regclass('auth.users') is not null,
  'profiles', to_regclass('public.profiles') is not null,
  'topics', to_regclass('public.topics') is not null,
  'daily_assignments', to_regclass('public.daily_assignments') is not null,
  'editorial_memberships', to_regclass('public.editorial_memberships') is not null,
  'profile_sharing', to_regclass('public.profile_sharing') is not null,
  'edge_api_health', to_regprocedure('public.edge_api_health()') is not null,
  'edge_api_stats', to_regprocedure('public.edge_api_stats(uuid)') is not null,
  'public_relations', coalesce((
    select json_agg(c.relname order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  ), '[]'::json),
  'public_functions', coalesce((
    select json_agg(distinct p.proname order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ), '[]'::json),
  'profiles_columns', coalesce((
    select json_agg(json_build_object(
      'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'has_default', d.oid is not null
    ) order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('public.profiles') and a.attnum > 0 and not a.attisdropped
  ), '[]'::json),
  'profiles_constraints', coalesce((
    select json_agg(json_build_object('name', k.conname, 'type', k.contype) order by k.conname)
    from pg_constraint k where k.conrelid = to_regclass('public.profiles')
  ), '[]'::json),
  'profiles_inbound_references', coalesce((
    select json_agg(json_build_object('table', k.conrelid::regclass::text, 'name', k.conname) order by k.conname)
    from pg_constraint k where k.confrelid = to_regclass('public.profiles') and k.contype = 'f'
  ), '[]'::json),
  'profiles_triggers', coalesce((
    select json_agg(t.tgname order by t.tgname)
    from pg_trigger t where t.tgrelid = to_regclass('public.profiles') and not t.tgisinternal
  ), '[]'::json),
  'auth_user_triggers', coalesce((
    select json_agg(t.tgname order by t.tgname)
    from pg_trigger t where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal
  ), '[]'::json)
)::text"""


def connection_environment(staging_ref: str, production_ref: str, direct_url: str) -> dict[str, str]:
    """Refuse a production or unrelated connection before starting psql."""
    if not PROJECT_REF.fullmatch(staging_ref) or not PROJECT_REF.fullmatch(production_ref):
        raise ValueError("Valid staging and production project references are required")
    if staging_ref == production_ref:
        raise ValueError("Staging and production project references must differ")
    try:
        parsed = urlsplit(direct_url)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Malformed staging connection URL") from exc
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise ValueError("A PostgreSQL staging connection URL is required")
    if parsed.path != "/postgres" or port != 5432 or not parsed.password:
        raise ValueError("Use the staging project's port-5432 postgres connection URL")
    direct = parsed.hostname == f"db.{staging_ref}.supabase.co" and parsed.username == "postgres"
    session_pooler = (
        parsed.hostname.endswith(".pooler.supabase.com")
        and parsed.username == f"postgres.{staging_ref}"
    )
    if not (direct or session_pooler):
        raise ValueError("Connection does not identify the requested staging project")
    env = os.environ.copy()
    env.pop("STAGING_DIRECT_URL", None)
    env.update({
        "PGHOST": parsed.hostname,
        "PGPORT": str(port),
        "PGDATABASE": "postgres",
        "PGUSER": unquote(parsed.username),
        "PGPASSWORD": unquote(parsed.password),
        "PGSSLMODE": "require",
    })
    return env


def psql(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", *args],
        env=env, text=True, capture_output=True, check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-only", action="store_true", help="validate target and list files without connecting")
    mode.add_argument("--inspect", action="store_true", help="read only staging schema presence flags")
    args = parser.parse_args()
    try:
        env = connection_environment(
            os.environ.get("STAGING_PROJECT_REF", ""),
            os.environ.get("PRODUCTION_PROJECT_REF", ""),
            os.environ.get("STAGING_DIRECT_URL", ""),
        )
    except ValueError as exc:
        print(f"Target guard: {exc}", file=sys.stderr)
        return 2
    files = sorted(MIGRATIONS.glob("0*.sql"))
    if not files:
        print("No migration files found", file=sys.stderr)
        return 2
    print(f"Validated staging target; {len(files)} ordered migrations through {files[-1].name}")
    if args.check_only:
        return 0
    if not shutil.which("psql"):
        print("psql is required", file=sys.stderr)
        return 2
    if args.inspect:
        inspection = psql(env, "-At", "-c", INSPECT_SQL)
        try:
            flags = json.loads(inspection.stdout)
        except json.JSONDecodeError:
            flags = None
        if inspection.returncode != 0 or not isinstance(flags, dict):
            print("Could not inspect staging schema", file=sys.stderr)
            return 1
        if flags.get("profiles"):
            rows = psql(env, "-At", "-c", "select exists(select 1 from public.profiles)")
            if rows.returncode != 0 or rows.stdout.strip() not in ("t", "f"):
                print("Could not check staging profile row presence", file=sys.stderr)
                return 1
            flags["profiles_has_rows"] = rows.stdout.strip() == "t"
        print(json.dumps(flags, sort_keys=True))
        return 0
    check = psql(env, "-At", "-c", "select to_regclass('auth.users') is not null, to_regclass('public.profiles') is null")
    if check.returncode != 0 or check.stdout.strip() != "t|t":
        print("Target is not a fresh Supabase project; inspect its schema before applying SQL", file=sys.stderr)
        return 2
    for file in files:
        result = psql(env, "-q", "-f", str(file))
        if result.returncode != 0:
            print(f"Migration stopped at {file.name}; inspect staging before retrying", file=sys.stderr)
            print(result.stderr[-2000:], file=sys.stderr)
            return 1
        print(f"Applied {file.name}")
    verify = psql(env, "-At", "-c", "select to_regprocedure('public.edge_api_stats(uuid)') is not null")
    if verify.returncode != 0 or verify.stdout.strip() != "t":
        print("Final staging schema verification failed", file=sys.stderr)
        return 1
    print("Staging schema installed and final API RPC verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

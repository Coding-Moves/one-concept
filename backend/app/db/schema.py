"""Read-only schema contract, derived from the migrations on disposable PG16.

The filename ledger records an operator action; it is never used as evidence
here. Compare actual database objects, including definitions and RLS, against
the reviewed contract packaged in the exact image being deployed.
"""

import hashlib
import json
from pathlib import Path

from sqlalchemy import text

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "schema" / "contract.json"
TABLES = (
    "profiles", "topics", "concepts", "user_topics", "daily_assignments",
    "concept_interactions", "notification_preferences", "device_tokens",
    "concept_backlog", "reminder_log", "generation_daily_usage",
    "content_supply_targets", "concept_revisions", "content_retry_log",
    "daily_reviews", "content_worker_runs", "content_conditions",
    "achievement_definitions", "user_achievements",
)


def migration_hashes() -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((ROOT / "migrations").glob("0*.sql"))}


async def snapshot(connection) -> dict:
    """Only metadata for this application's objects; never read user records."""
    await connection.execute(text("set local search_path = pg_catalog"))
    queries = {
        "tables": """select c.relname as name, c.relrowsecurity as rls
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=any(:tables) and c.relkind='r'""",
        "columns": """select c.relname||'.'||a.attname as name,
          format_type(a.atttypid,a.atttypmod) as type, a.attnotnull as not_null,
          pg_get_expr(d.adbin,d.adrelid) as default, a.attidentity::text as identity
          from pg_attribute a join pg_class c on c.oid=a.attrelid
          join pg_namespace n on n.oid=c.relnamespace
          left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
          where n.nspname='public' and c.relname=any(:tables)
            and a.attnum>0 and not a.attisdropped""",
        "constraints": """select c.relname||'.'||k.conname as name,
          pg_get_constraintdef(k.oid) as definition, k.convalidated as validated
          from pg_constraint k join pg_class c on c.oid=k.conrelid
          join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=any(:tables)""",
        "indexes": """select i.relname as name, pg_get_indexdef(i.oid) as definition,
          x.indisvalid as valid, x.indisready as ready
          from pg_index x join pg_class c on c.oid=x.indrelid
          join pg_class i on i.oid=x.indexrelid
          join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=any(:tables)""",
        "policies": """select tablename||'.'||policyname as name,
          permissive, roles::text, cmd, qual, with_check
          from pg_policies where schemaname='public' and tablename=any(:tables)""",
        "triggers": """select n.nspname||'.'||c.relname||'.'||t.tgname as name,
          pg_get_triggerdef(t.oid) as definition, t.tgenabled::text as enabled
          from pg_trigger t join pg_class c on c.oid=t.tgrelid
          join pg_namespace n on n.oid=c.relnamespace
          where not t.tgisinternal and
            ((n.nspname='public' and c.relname=any(:tables)) or
             (n.nspname='auth' and c.relname='users' and t.tgname='on_auth_user_created'))""",
        "functions": """select p.proname as name, pg_get_functiondef(p.oid) as definition
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('handle_new_user','touch_updated_at')""",
    }
    result = {}
    for kind, query in queries.items():
        rows = (await connection.execute(text(query), {"tables": list(TABLES)})).mappings()
        result[kind] = {row["name"]: {k: v for k, v in row.items() if k != "name"}
                        for row in rows}
    return result


async def verify_schema(connection) -> list[str]:
    contract = json.loads(CONTRACT_PATH.read_text())
    if contract["migrations"] != migration_hashes():
        return ["Schema contract does not match the image's migration files"]
    actual = await snapshot(connection)
    errors = []
    for kind, expected in contract["schema"].items():
        for name, properties in expected.items():
            if actual[kind].get(name) != properties:
                errors.append(f"Missing or changed {kind}: {name}")
        # Additional policies could expose previously backend-only data.
        if kind == "policies":
            for name in actual[kind].keys() - expected.keys():
                errors.append(f"Unexpected policy: {name}")
    return errors

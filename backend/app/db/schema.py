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
    "owner_operation_events",
    "editorial_notification_policy", "editorial_notification_outbox",
    "editorial_email_batches", "editorial_email_attempts",
    "editorial_generation_jobs", "editorial_workflow_events", "editorial_request_receipts",
    "editorial_legacy_batches", "editorial_legacy_batch_entries",
    "editorial_legacy_versions", "editorial_revision_events", "editorial_publications",
    "editorial_memberships", "editorial_account_events",
    "connection_preferences", "connections", "connection_blocks", "connection_request_events", "profile_connections",
    "profiles", "profile_sharing", "topics", "subtopics", "concepts", "user_topics", "daily_assignments",
    "concept_interactions", "notification_preferences", "device_tokens",
    "concept_backlog", "reminder_log", "generation_daily_usage",
    "future_refill_daily_usage", "future_refill_topic_daily_usage",
    "content_supply_targets", "concept_revisions", "content_retry_log",
    "daily_reviews", "content_worker_runs", "content_conditions",
    "achievement_definitions", "user_achievements", "user_concept_completions",
    "user_subtopic_completions", "weekly_quizzes", "weekly_quiz_notifications",
    "weekly_quiz_attempts", "subtopic_quizzes", "subtopic_quiz_attempts",
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
          where n.nspname='public' and p.proname in ('handle_new_user','touch_updated_at',
            'prevent_editorial_evidence_mutation','protect_reviewed_revision_body',
            'protect_editorial_job_input','protect_generated_revision_body',
            'capture_editorial_notification','enqueue_editorial_notification',
            'edge_api_health','edge_api_topics','edge_api_concept',
            'edge_api_set_interaction','edge_api_notifications',
            'edge_api_set_notifications','edge_api_push_token','edge_api_stats',
            'edge_api_history','edge_api_saved',
            'edge_api_subtopic_progress','edge_api_mark_subtopics_seen',
            'edge_api_daily_payload','edge_api_signal_supply','edge_api_daily',
            'edge_api_record_subtopic_completion','edge_api_award_eligible',
            'edge_api_complete_daily','edge_api_achievements',
            'edge_api_achievements_seen','edge_api_review_payload',
            'edge_api_choose_review','edge_api_complete_review',
            'edge_api_state','edge_api_weekly_quiz','edge_api_subtopic_quiz',
            'edge_api_editorial_me','edge_api_editorial_authorize_any',
            'edge_api_editorial_taxonomy','edge_api_editorial_activity',
            'edge_api_editorial_legacy_entries','edge_api_editorial_queue',
            'edge_api_editorial_revision_history',
            'edge_api_editorial_utc_iso','edge_api_editorial_job_public',
            'edge_api_editorial_generation_jobs',
            'edge_api_editorial_generation_job',
            'edge_api_editorial_generation_supply',
            'edge_api_editorial_legacy_eligibility',
            'edge_api_editorial_concept_timeline',
            'edge_api_editorial_legacy_batch_public',
            'edge_api_editorial_legacy_batches',
            'edge_api_editorial_utc_iso_exact',
            'edge_api_editorial_notification_policy',
            'edge_api_editorial_notifications_overview',
            'edge_api_editorial_notification_retry',
            'edge_api_editorial_owner_operations',
            'edge_api_editorial_owner_window',
            'edge_api_editorial_owner_overview',
            'edge_api_editorial_owner_reviewers',
            'edge_api_editorial_owner_events',
            'edge_api_editorial_reviewer_access',
            'edge_api_editorial_invite_prepare',
            'edge_api_editorial_invite_finish',
            'edge_api_editorial_cancel_generation_job',
            'edge_api_editorial_legacy_batch_action',
            'edge_api_editorial_create_legacy_batch')""",
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

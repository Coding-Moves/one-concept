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
DEMO_PROJECT_REF = "zhrulokgngjceqgjkcmw"
INCREMENTAL_BASELINE = "0049_supabase_stats_api.sql"
INCREMENTAL_PROBES = {
    "0050_supabase_collections_api.sql": (
        "public.edge_api_history(uuid,date,integer)",
        "public.edge_api_saved(uuid,timestamp with time zone,uuid,integer)",
    ),
    "0051_supabase_subtopic_progress_api.sql": (
        "public.edge_api_subtopic_progress(uuid)",
        "public.edge_api_mark_subtopics_seen(uuid,uuid[])",
    ),
    "0052_supabase_daily_selection_api.sql": (
        "public.edge_api_daily_payload(uuid,date)",
        "public.edge_api_signal_supply(uuid,uuid,integer,integer,integer)",
        "public.edge_api_daily(uuid,integer,integer,integer,date)",
    ),
    "0053_supabase_daily_completion_api.sql": (
        "public.edge_api_record_subtopic_completion(uuid,uuid)",
        "public.edge_api_award_eligible(uuid)",
        "public.edge_api_complete_daily(uuid,date)",
    ),
    "0054_supabase_achievements_api.sql": (
        "public.edge_api_achievements(uuid)",
        "public.edge_api_achievements_seen(uuid,text[])",
    ),
    "0055_supabase_daily_reviews_api.sql": (
        "public.edge_api_review_payload(uuid,date)",
        "public.edge_api_choose_review(uuid,date)",
        "public.edge_api_complete_review(uuid,uuid,date)",
    ),
    "0056_supabase_learner_state_api.sql": (
        "public.edge_api_state(uuid,boolean,boolean,integer,integer,integer,date)",
    ),
    "0057_supabase_followed_topics_api.sql": (
        "public.edge_api_profile_snapshot(uuid,boolean,date)",
        "public.edge_api_set_topics(uuid,text[],boolean,date)",
    ),
    "0058_supabase_profile_update_api.sql": (
        "public.edge_api_patch_profile(uuid,text,boolean,text,text,text,boolean,boolean,date)",
    ),
    "0059_supabase_analytics_api.sql": (
        "public.edge_api_analytics(uuid)",
    ),
    "0060_supabase_profile_sharing_settings_api.sql": (
        "public.edge_api_new_profile_token()",
        "public.edge_api_sharing_get(uuid)",
        "public.edge_api_sharing_put(uuid,boolean,boolean,boolean,boolean,boolean,boolean,text[],integer)",
    ),
    "0061_supabase_public_profile_api.sql": (
        "public.edge_api_public_profile(text)",
    ),
    "0062_supabase_connection_preferences_api.sql": (
        "public.edge_api_connection_settings_get(uuid)",
        "public.edge_api_connection_settings_put(uuid,boolean,integer)",
    ),
    "0063_supabase_connection_list_api.sql": (
        "public.edge_api_connections(uuid,text,uuid,integer)",
    ),
    "0064_supabase_connection_status_api.sql": (
        "public.edge_api_connection_status(uuid,text)",
    ),
    "0065_supabase_connection_request_api.sql": (
        "public.edge_api_connection_request(uuid,text)",
    ),
    "0066_supabase_connection_block_token_api.sql": (
        "public.edge_api_connection_block_token(uuid,text)",
    ),
    "0067_supabase_connection_action_api.sql": (
        "public.edge_api_connection_action(uuid,uuid,text)",
    ),
    "0068_supabase_connection_unblock_api.sql": (
        "public.edge_api_connection_unblock(uuid,uuid)",
    ),
    "0069_supabase_relationship_status_api.sql": (
        "public.edge_api_relationship_status(uuid,text)",
    ),
    "0070_supabase_relationship_connect_api.sql": (
        "public.edge_api_relationship_connect(uuid,text)",
    ),
    "0071_supabase_relationship_remove_api.sql": (
        "public.edge_api_relationship_remove(uuid,uuid)",
    ),
    "0072_supabase_relationship_block_api.sql": (
        "public.edge_api_relationship_block(uuid,uuid)",
    ),
    "0073_supabase_relationship_list_api.sql": (
        "public.edge_api_relationships(uuid,timestamp with time zone,uuid,integer)",
    ),
    "0074_supabase_weekly_quiz_selection_api.sql": (
        "public.edge_api_weekly_quiz(uuid)",
    ),
    "0075_supabase_weekly_quiz_attempt_api.sql": (
        "public.edge_api_submit_weekly_quiz(uuid,uuid,jsonb)",
    ),
    "0076_supabase_subtopic_quiz_selection_api.sql": (
        "public.edge_api_subtopic_quiz(uuid,uuid)",
    ),
    "0077_supabase_subtopic_quiz_attempt_api.sql": (
        "public.edge_api_submit_subtopic_quiz(uuid,uuid,jsonb)",
    ),
    "0078_supabase_subtopic_quiz_history_api.sql": (
        "public.edge_api_subtopic_quiz_attempts(uuid,uuid)",
    ),
    "0079_supabase_editorial_me_api.sql": (
        "public.edge_api_editorial_me(uuid,uuid,text)",
    ),
    "0080_supabase_editorial_reviewers_list_api.sql": (
        "public.edge_api_editorial_authorize(uuid,uuid,text,text)",
        "public.edge_api_editorial_reviewers(uuid,uuid,text,uuid,integer)",
    ),
    "0081_supabase_editorial_profile_request_api.sql": (
        "public.edge_api_editorial_request_profile(uuid,uuid,text,integer,text)",
    ),
    "0082_supabase_editorial_timezone_api.sql": (
        "public.edge_api_editorial_notification_timezone(uuid,uuid,text,integer,text)",
    ),
    "0083_supabase_editorial_authenticator_api.sql": (
        "public.edge_api_editorial_authenticator(uuid,uuid,text,bigint,integer,boolean)",
    ),
    "0084_supabase_editorial_profile_approval_api.sql": (
        "public.edge_api_editorial_approve_profile(uuid,uuid,text,uuid,integer)",
    ),
    "0085_supabase_auth_read_rpc_privileges.sql": (
        "definer:public.edge_api_daily(uuid,integer,integer,integer,date)",
        "definer:public.edge_api_achievements(uuid)",
        "definer:public.edge_api_weekly_quiz(uuid)",
        "definer:public.edge_api_subtopic_quiz(uuid,uuid)",
        "definer:public.edge_api_editorial_me(uuid,uuid,text)",
    ),
    "0086_supabase_editorial_taxonomy_api.sql": (
        "public.edge_api_editorial_authorize_any(uuid,uuid,text,text[])",
        "public.edge_api_editorial_taxonomy(uuid,uuid,text,uuid,integer)",
    ),
    "0087_supabase_editorial_activity_api.sql": (
        "public.edge_api_editorial_activity(uuid,uuid,text,uuid,uuid,integer)",
    ),
    "0088_supabase_editorial_legacy_entries_api.sql": (
        "public.edge_api_editorial_legacy_entries(uuid,uuid,text,uuid)",
    ),
    "0089_supabase_editorial_queue_api.sql": (
        "public.edge_api_editorial_queue(uuid,uuid,text,text,text,uuid,uuid,uuid,text,text,uuid,integer)",
    ),
    "0090_supabase_editorial_revision_history_api.sql": (
        "public.edge_api_editorial_revision_history(uuid,uuid,text,uuid,uuid,integer)",
    ),
    "0091_supabase_editorial_generation_jobs_api.sql": (
        "public.edge_api_editorial_utc_iso(timestamp with time zone)",
        "public.edge_api_editorial_job_public(public.editorial_generation_jobs)",
        "public.edge_api_editorial_generation_jobs(uuid,uuid,text,text,uuid,uuid,uuid,integer)",
        "public.edge_api_editorial_generation_job(uuid,uuid,text,uuid)",
    ),
    "0092_supabase_editorial_generation_supply_api.sql": (
        "public.edge_api_editorial_generation_supply(uuid,uuid,text,uuid,integer,integer,boolean,boolean)",
    ),
    "0093_supabase_editorial_legacy_eligibility_api.sql": (
        "public.edge_api_editorial_legacy_eligibility(uuid,uuid,text,uuid,boolean)",
    ),
    "0094_supabase_editorial_concept_timeline_api.sql": (
        "public.edge_api_editorial_concept_timeline(uuid,uuid,text,uuid,timestamp with time zone,text,integer)",
    ),
    "0095_supabase_editorial_legacy_batches_api.sql": (
        "public.edge_api_editorial_legacy_batch_public(public.editorial_legacy_batches)",
        "public.edge_api_editorial_legacy_batches(uuid,uuid,text,uuid)",
    ),
    "0096_supabase_editorial_timestamp_precision.sql": (
        "public.edge_api_editorial_utc_iso_exact(timestamp with time zone)",
    ),
    "0097_supabase_editorial_notification_policy_api.sql": (
        "public.edge_api_editorial_notification_policy(uuid,uuid,text,integer,integer,integer,integer)",
    ),
    "0098_supabase_editorial_notifications_overview_api.sql": (
        "public.edge_api_editorial_notifications_overview(uuid,uuid,text,uuid,integer,text,integer)",
    ),
    "0099_supabase_editorial_notification_retry_api.sql": (
        "public.edge_api_editorial_notification_retry(uuid,uuid,text,uuid,integer,text)",
    ),
    "0100_supabase_editorial_owner_operations_api.sql": (
        "public.edge_api_editorial_owner_operations(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean,boolean,integer)",
    ),
    "0101_supabase_editorial_owner_overview_api.sql": (
        "public.edge_api_editorial_owner_window(date,date)",
        "public.edge_api_editorial_owner_overview(uuid,uuid,text,date,date)",
    ),
    "0102_supabase_editorial_owner_reviewers_api.sql": (
        "public.edge_api_editorial_owner_reviewers(uuid,uuid,text,date,date,uuid,integer)",
    ),
    "0103_supabase_editorial_owner_events_api.sql": (
        "public.edge_api_editorial_owner_events(uuid,uuid,text,date,date,text,text,text,uuid,timestamptz,text,integer)",
    ),
    "0104_supabase_editorial_reviewer_access_api.sql": (
        "public.edge_api_editorial_reviewer_access(uuid,uuid,text,uuid,integer,text,text[])",
    ),
    "0105_supabase_editorial_reviewer_invite_api.sql": (
        "public.edge_api_editorial_invite_prepare(uuid,uuid,text,text)",
        "public.edge_api_editorial_invite_finish(uuid,uuid,text,text,uuid,text[])",
    ),
    "0106_supabase_editorial_generation_cancel_api.sql": (
        "public.edge_api_editorial_cancel_generation_job(uuid,uuid,text,uuid,uuid,text,text,text)",
    ),
    "0107_supabase_editorial_legacy_batch_action_api.sql": (
        "public.edge_api_editorial_legacy_batch_action(uuid,uuid,text,uuid,uuid,text,text,text,text)",
    ),
    "0108_supabase_editorial_legacy_batch_create_api.sql": (
        "public.edge_api_editorial_create_legacy_batch(uuid,uuid,text,uuid,uuid,text,text,integer,text,boolean,text)",
    ),
    "0109_supabase_editorial_generation_request_api.sql": (
        "public.edge_api_editorial_request_generation(uuid,uuid,text,uuid,uuid,text,integer,boolean,integer,integer,integer,text)",
    ),
    "0110_supabase_editorial_concept_detail_api.sql": (
        "public.edge_api_editorial_concept_detail_source(uuid,uuid,text,uuid)",
    ),
    "0111_supabase_editorial_revision_detail_api.sql": (
        "public.edge_api_editorial_revision_detail_source(uuid,uuid,text,uuid)",
    ),
    "0112_supabase_editorial_stage_revision_api.sql": (
        "public.edge_api_editorial_python_json(jsonb)",
        "public.edge_api_editorial_stage_revision(uuid,uuid,text,uuid,uuid,text,text,jsonb,text)",
    ),
}
FRESH_SQL = """set row_security = off;
select
  to_regclass('auth.users') is not null,
  to_regnamespace('public') is not null,
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  ),
  not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')
  ),
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) and not exists (
    select 1 from pg_event_trigger where evtname = 'ensure_rls'
  ),
  not exists (
    select 1 from pg_trigger t
    where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal
  ),
  not exists (select 1 from auth.users)"""
RESET_DEMO_SQL = """begin;
set local row_security = off;
do $$
declare
  relations text[];
  functions text[];
begin
  if current_database() <> 'postgres' or to_regclass('auth.users') is null
    or to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'demo reset refused: unexpected database';
  end if;
  if exists(select 1 from storage.objects) then
    raise exception 'demo reset refused: Storage objects exist';
  end if;
  if exists(select 1 from storage.buckets) then
    raise exception 'demo reset refused: Storage buckets exist';
  end if;
  if exists(select 1 from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) then
    raise exception 'demo reset refused: Auth user triggers exist';
  end if;
  select coalesce(array_agg(c.relname::text || ':' || c.relkind::text order by c.relname), '{}'::text[])
    into relations
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c');
  if relations <> array[
    'admins:r', 'payout_requests:r', 'profiles:r',
    'screenshots:r', 'tasks:r', 'wallets:r'
  ] then
    raise exception 'demo reset refused: public relation inventory changed';
  end if;
  if exists(select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e', 'd')) then
    raise exception 'demo reset refused: custom public types exist';
  end if;
  select coalesce(array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    order by p.proname, pg_get_function_identity_arguments(p.oid)), '{}'::text[])
    into functions
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public';
  if functions <> array['rls_auto_enable()'] then
    raise exception 'demo reset refused: public function inventory changed';
  end if;
  if not exists(select 1 from pg_event_trigger
    where evtname = 'ensure_rls'
      and evtfoid = to_regprocedure('public.rls_auto_enable()')) then
    raise exception 'demo reset refused: event trigger inventory changed';
  end if;
end $$;
drop table public.admins, public.payout_requests, public.profiles,
  public.screenshots, public.tasks, public.wallets restrict;
drop event trigger ensure_rls restrict;
drop function public.rls_auto_enable() restrict;
delete from auth.users;
commit;"""
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


def function_presence(env: dict[str, str], signatures: tuple[str, ...]) -> tuple[bool, ...] | None:
    """Read only the existence of reviewed RPC signatures, never application rows."""
    reviewed = {"public.edge_api_stats(uuid)"}
    reviewed.update(signature for probes in INCREMENTAL_PROBES.values() for signature in probes)
    if not signatures or any(item not in reviewed for item in signatures):
        raise ValueError("Unreviewed incremental migration probe")
    expressions = ", ".join(
        f"coalesce((select prosecdef from pg_proc where oid = to_regprocedure('{item[8:]}')), false)"
        if item.startswith("definer:") else f"to_regprocedure('{item}') is not null"
        for item in signatures
    )
    result = psql(env, "-qAt", "-F", "|", "-c", f"select {expressions}")
    values = result.stdout.strip().split("|")
    if result.returncode != 0 or len(values) != len(signatures) or any(value not in ("t", "f") for value in values):
        return None
    return tuple(value == "t" for value in values)


def apply_incremental(env: dict[str, str], files: list[Path]) -> int:
    """Apply only migrations with explicit before/after RPC probes to reviewed staging."""
    if os.environ["STAGING_PROJECT_REF"] != DEMO_PROJECT_REF:
        print("Incremental migration refused: staging project reference does not match", file=sys.stderr)
        return 2
    names = [file.name for file in files]
    if INCREMENTAL_BASELINE not in names:
        print("Incremental migration refused: baseline file is missing", file=sys.stderr)
        return 2
    pending = files[names.index(INCREMENTAL_BASELINE) + 1:]
    if {file.name for file in pending} != set(INCREMENTAL_PROBES):
        print("Incremental migration refused: every later migration needs reviewed probes", file=sys.stderr)
        return 2
    baseline = function_presence(env, ("public.edge_api_stats(uuid)",))
    if baseline != (True,):
        print("Incremental migration refused: verified 0049 baseline is absent", file=sys.stderr)
        return 2
    for file in pending:
        probes = INCREMENTAL_PROBES[file.name]
        before = function_presence(env, probes)
        if before is None or (any(before) and not all(before)):
            print(f"Migration {file.name} has an incomplete or unreadable baseline", file=sys.stderr)
            return 2
        if all(before):
            print(f"Already present: {file.name}")
            continue
        result = psql(env, "-q", "-f", str(file))
        if result.returncode != 0 or function_presence(env, probes) != (True,) * len(probes):
            print(f"Migration {file.name} failed or its RPC verification failed", file=sys.stderr)
            print(result.stderr[-1200:], file=sys.stderr)
            return 1
        print(f"Applied and verified {file.name}")
    return reload_schema_cache(env)


def reload_schema_cache(env: dict[str, str]) -> int:
    """Tell staging PostgREST to recognize newly installed RPC signatures."""
    if os.environ["STAGING_PROJECT_REF"] != DEMO_PROJECT_REF:
        print("Schema cache reload refused: staging project reference does not match", file=sys.stderr)
        return 2
    result = psql(env, "-q", "-c", "NOTIFY pgrst, 'reload schema'")
    if result.returncode != 0:
        print("Could not request staging PostgREST schema reload", file=sys.stderr)
        return 1
    print("Requested staging PostgREST schema reload")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-only", action="store_true", help="validate target and list files without connecting")
    mode.add_argument("--inspect", action="store_true", help="read only staging schema presence flags")
    mode.add_argument("--reset-demo", action="store_true", help="remove the reviewed demo schema and Auth users from one staging project")
    mode.add_argument("--apply-incremental", action="store_true", help="apply explicitly probed migrations after the verified 0049 staging baseline")
    mode.add_argument("--reload-cache", action="store_true", help="notify staging PostgREST to reload its schema cache")
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
    if args.apply_incremental:
        return apply_incremental(env, files)
    if args.reload_cache:
        return reload_schema_cache(env)
    if args.reset_demo:
        if os.environ["STAGING_PROJECT_REF"] != DEMO_PROJECT_REF:
            print("Demo reset refused: staging project reference does not match", file=sys.stderr)
            return 2
        reset = psql(env, "-q", "-c", RESET_DEMO_SQL)
        if reset.returncode != 0:
            print("Demo reset stopped without committing", file=sys.stderr)
            print(reset.stderr[-1200:], file=sys.stderr)
            return 1
        fresh = psql(env, "-qAt", "-F", "|", "-c", FRESH_SQL)
        if fresh.returncode != 0 or fresh.stdout.strip() != "t|t|t|t|t|t|t":
            print("Demo reset committed but staging is not fresh; inspect before migrations", file=sys.stderr)
            return 1
        print("Reviewed staging demo schema and Auth users removed; fresh-project check passed")
        return 0
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
            rows = psql(env, "-qAt", "-c", "set row_security = off; select exists(select 1 from public.profiles)")
            if rows.returncode != 0 or rows.stdout.strip() not in ("t", "f"):
                print("Could not check staging profile row presence", file=sys.stderr)
                return 1
            flags["profiles_has_rows"] = rows.stdout.strip() == "t"
        print(json.dumps(flags, sort_keys=True))
        return 0
    check = psql(env, "-qAt", "-F", "|", "-c", FRESH_SQL)
    if check.returncode != 0 or check.stdout.strip() != "t|t|t|t|t|t|t":
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
    return reload_schema_cache(env)


if __name__ == "__main__":
    raise SystemExit(main())

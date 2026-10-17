"""Locate a staging learner RPC failure without logging account data or secrets.

Every probe runs inside a transaction that is rolled back. Only fixed labels and
PostgreSQL SQLSTATE codes reach the job log.
"""

import os
import re
import shutil
import subprocess
import sys

from tools.apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


EMAIL = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+$")
RESULT = re.compile(r"diagnostic=(state|daily|history|saved|stats|achievements|user):((?:[A-Z0-9]{5})|ok|missing)")


def diagnostic_sql(email: str) -> str:
    if len(email) > 254 or not EMAIL.fullmatch(email):
        raise ValueError("A valid staging test email is required")
    # The constrained email alphabet has no SQL quote or backslash.
    return f"""
begin;
do $lookup$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower('{email}') limit 1;
  if v_user is null then
    raise notice 'diagnostic=user:missing';
    v_user := '00000000-0000-0000-0000-000000000000'::uuid;
  else
    raise notice 'diagnostic=user:ok';
  end if;
  perform set_config('diagnostic.user_id', v_user::text, true);
end
$lookup$;
set local role service_role;
do $diagnostic$
declare v_user uuid := current_setting('diagnostic.user_id')::uuid;
begin
  begin
    perform public.edge_api_state(v_user, true, true, 10, 60, 90, null);
    raise notice 'diagnostic=state:ok';
  exception when others then raise notice 'diagnostic=state:%', sqlstate; end;
  begin
    perform public.edge_api_daily(v_user, 10, 60, 90, null);
    raise notice 'diagnostic=daily:ok';
  exception when others then raise notice 'diagnostic=daily:%', sqlstate; end;
  begin
    perform public.edge_api_history(v_user, null, 50);
    raise notice 'diagnostic=history:ok';
  exception when others then raise notice 'diagnostic=history:%', sqlstate; end;
  begin
    perform public.edge_api_saved(v_user, null, null, 50);
    raise notice 'diagnostic=saved:ok';
  exception when others then raise notice 'diagnostic=saved:%', sqlstate; end;
  begin
    perform public.edge_api_stats(v_user);
    raise notice 'diagnostic=stats:ok';
  exception when others then raise notice 'diagnostic=stats:%', sqlstate; end;
  begin
    perform public.edge_api_achievements(v_user);
    raise notice 'diagnostic=achievements:ok';
  exception when others then raise notice 'diagnostic=achievements:%', sqlstate; end;
end
$diagnostic$;
rollback;
"""


def main() -> int:
    try:
        staging = os.environ["STAGING_PROJECT_REF"]
        if staging != DEMO_PROJECT_REF:
            raise ValueError("Refusing an unreviewed staging project")
        env = connection_environment(staging, os.environ["PRODUCTION_PROJECT_REF"],
                                     os.environ["STAGING_DIRECT_URL"])
        sql = diagnostic_sql(os.environ["SUPABASE_STAGING_TEST_EMAIL"])
        if not shutil.which("psql"):
            raise ValueError("psql is required")
        run = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q"],
                             input=sql, env=env, text=True, capture_output=True,
                             check=False, timeout=30)
        if run.returncode != 0:
            print("Staging learner diagnostic could not complete", file=sys.stderr)
            return 1
        results = RESULT.findall(run.stderr)
        if not results or results[0] != ("user", "ok"):
            print("Staging diagnostic test user was not found", file=sys.stderr)
            return 1
        for label, status in results[1:]:
            print(f"{label}: {status}")
        return 0 if len(results) == 7 else 1
    except (KeyError, ValueError, OSError, subprocess.TimeoutExpired):
        print("Staging learner diagnostic setup failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

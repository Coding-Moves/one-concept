"""Set the staging worker's Edge and Vault secrets without printing values."""

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, connection_environment
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, connection_environment


SIGNING_KEY = re.compile(r"[A-Za-z0-9_-]{32,128}\Z")


def main() -> int:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    key = os.environ.get("STAGING_WORKER_SIGNING_KEY", "")
    database_url = os.environ.get("STAGING_DIRECT_URL", "")
    if staging != DEMO_PROJECT_REF or staging == production or not SIGNING_KEY.fullmatch(key):
        print("Worker secret setup refused: target or signing key invalid", file=sys.stderr)
        return 2
    if any(character in database_url for character in "\r\n"):
        print("Worker secret setup refused: connection format invalid", file=sys.stderr)
        return 2
    try:
        db_env = connection_environment(staging, production, database_url)
    except ValueError:
        print("Worker secret setup refused: connection target invalid", file=sys.stderr)
        return 2
    url = f"https://{staging}.supabase.co/functions/v1/worker"
    sql = f"""begin;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;
do $vault$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name='one_concept_worker_url';
  if v_id is null then
    perform vault.create_secret('{url}', 'one_concept_worker_url',
      'Staging worker function URL');
  else
    perform vault.update_secret(v_id, '{url}', 'one_concept_worker_url',
      'Staging worker function URL');
  end if;
  select id into v_id from vault.secrets
    where name='one_concept_worker_signing_key';
  if v_id is null then
    perform vault.create_secret('{key}', 'one_concept_worker_signing_key',
      'Staging worker dispatch signing key');
  else
    perform vault.update_secret(v_id, '{key}',
      'one_concept_worker_signing_key',
      'Staging worker dispatch signing key');
  end if;
  if (select count(*) from vault.decrypted_secrets
      where (name='one_concept_worker_url' and decrypted_secret='{url}')
         or (name='one_concept_worker_signing_key'
           and decrypted_secret='{key}'))<>2 then
    raise exception 'Staging worker Vault verification failed';
  end if;
end
$vault$;
commit;"""
    result = subprocess.run(
        ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"],
        input=sql, env=db_env, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        print("Worker staging Vault setup failed", file=sys.stderr)
        return 1
    # The CLI accepts an env-file. The temporary file and its path never enter
    # Git, job output, or command arguments containing secret values.
    env_file: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", prefix="worker-staging-",
                                         delete=False) as handle:
            env_file = Path(handle.name)
            os.chmod(env_file, 0o600)
            handle.write(f"WORKER_DISPATCH_SIGNING_KEY={key}\n")
            handle.write(f"WORKER_DATABASE_URL={database_url}\n")
            handle.write("ENVIRONMENT=staging\n")
            handle.write("WORKER_GENERATION_TEST_ENABLED=false\n")
        result = subprocess.run(
            ["supabase", "secrets", "set", "--env-file", str(env_file),
             "--project-ref", staging],
            env=os.environ, text=True, capture_output=True, check=False,
        )
        if result.returncode:
            print("Worker staging Edge secret setup failed", file=sys.stderr)
            return 1
    finally:
        if env_file is not None:
            env_file.unlink(missing_ok=True)
    print("Staging worker Vault and Edge secrets configured")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

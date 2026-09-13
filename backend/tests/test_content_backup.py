"""Restore the disposable database into another database before relying on backups."""

import json
import subprocess

from conftest import CONTAINER


_CHECK = """select json_build_object(
  'concepts',(select count(*) from public.concepts),
  'revisions',(select count(*) from public.concept_revisions),
  'assignments',(select count(*) from public.daily_assignments),
  'reviews',(select count(*) from public.daily_reviews),
  'constraints',(select count(*) from pg_constraint where contype in ('p','u','f')),
  'rls',(select count(*) from pg_class where relrowsecurity))"""


def test_backup_restores_catalog_progress_and_schema(database, tmp_path):
    def command(*args, input=None):
        result = subprocess.run(
            ["podman", "exec", "-i", CONTAINER, *args], input=input, capture_output=True
        )
        assert result.returncode == 0, result.stderr.decode()[:500]
        return result.stdout

    backup = command(
        "pg_dump", "-U", "postgres", "-Fc", "--no-owner", "--no-acl", "postgres"
    )
    file = tmp_path / "fixture.dump"
    file.write_bytes(backup)
    command("createdb", "-U", "postgres", "content_restore_fixture")
    try:
        command(
            "pg_restore",
            "-U",
            "postgres",
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            "-d",
            "content_restore_fixture",
            input=file.read_bytes(),
        )
        original = json.loads(
            command("psql", "-U", "postgres", "-d", "postgres", "-Atc", _CHECK)
        )
        restored = json.loads(
            command(
                "psql",
                "-U",
                "postgres",
                "-d",
                "content_restore_fixture",
                "-Atc",
                _CHECK,
            )
        )
        assert original == restored
        assert restored["concepts"] >= 20 and restored["rls"] >= 15
    finally:
        command("dropdb", "-U", "postgres", "content_restore_fixture")

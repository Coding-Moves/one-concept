"""Staging worker setup must target only the reviewed project and hide secrets."""

import os
import subprocess
from pathlib import Path

from tools import configure_staging_worker as setup

STAGING = setup.DEMO_PROJECT_REF
PRODUCTION = "egdszjoesxlccauahmsx"
DATABASE_URL = (
    f"postgresql://postgres.{STAGING}:private-password"
    "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
)
SIGNING_KEY = "A" * 48


def configure_environment(monkeypatch):
    monkeypatch.setenv("STAGING_PROJECT_REF", STAGING)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", PRODUCTION)
    monkeypatch.setenv("STAGING_DIRECT_URL", DATABASE_URL)
    monkeypatch.setenv("STAGING_WORKER_SIGNING_KEY", SIGNING_KEY)


def test_rejects_wrong_target_before_writing(monkeypatch):
    configure_environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", STAGING)
    monkeypatch.setattr(setup.subprocess, "run", lambda *_, **__: AssertionError(
        "wrong target reached a subprocess"))
    assert setup.main() == 2


def test_configures_vault_and_edge_without_printing_secrets(monkeypatch, capsys):
    configure_environment(monkeypatch)
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[0] == "psql":
            assert SIGNING_KEY in kwargs["input"]
            assert kwargs["env"]["PGUSER"] == f"postgres.{STAGING}"
        else:
            assert args[:3] == ["supabase", "secrets", "set"]
            env_file = args[args.index("--env-file") + 1]
            assert os.stat(env_file).st_mode & 0o777 == 0o600
            content = Path(env_file).read_text(encoding="utf-8")
            assert f"WORKER_DISPATCH_SIGNING_KEY={SIGNING_KEY}\n" in content
            assert f"WORKER_DATABASE_URL={DATABASE_URL}\n" in content
            assert "ENVIRONMENT=staging\n" in content
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(setup.subprocess, "run", fake_run)
    assert setup.main() == 0
    assert len(calls) == 2
    output = capsys.readouterr()
    assert SIGNING_KEY not in output.out + output.err
    assert DATABASE_URL not in output.out + output.err

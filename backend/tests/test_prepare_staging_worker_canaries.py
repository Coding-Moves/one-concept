"""Protected canary setup must never write outside the reviewed staging ref."""

import subprocess
from pathlib import Path

import pytest
from tools import close_staging_worker_gates as gates
from tools import prepare_staging_worker_canaries as setup
from tools import staging_worker_canary_secrets as secrets


def fill_environment(monkeypatch):
    project = setup.DEMO_PROJECT_REF
    monkeypatch.setenv("STAGING_PROJECT_REF", project)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", f"postgresql://postgres.{project}:fixture"
                      "@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("STAGING_CANARY_LEARNER_EMAIL", "learner@example.test")
    monkeypatch.setenv("STAGING_CANARY_REVIEWER_EMAIL", "reviewer@example.test")
    monkeypatch.setenv("STAGING_CANARY_OWNER_EMAIL", "owner@example.test")
    monkeypatch.setenv("STAGING_CANARY_PUSH_TOKEN", "ExpoPushToken[stagingonly1234]")


def test_fixture_refuses_production_before_psql(monkeypatch):
    fill_environment(monkeypatch)
    monkeypatch.setenv("STAGING_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setattr(setup.subprocess, "run", lambda *_a, **_k: pytest.fail("psql called"))
    assert setup.main() == 2


def test_fixture_hides_private_inputs_on_database_error(monkeypatch, capsys):
    fill_environment(monkeypatch)
    seen = []

    def failed_psql(_args, **kwargs):
        seen.append(kwargs["input"])
        return subprocess.CompletedProcess([], 1, "", "private SQL error")

    monkeypatch.setattr(setup.subprocess, "run", failed_psql)
    assert setup.main() == 1
    assert "ExpoPushToken[stagingonly1234]" in seen[0]
    assert "ExpoPushToken" not in capsys.readouterr().err


def test_fixture_names_invalid_input_without_printing_it(monkeypatch, capsys):
    fill_environment(monkeypatch)
    monkeypatch.setenv("STAGING_CANARY_PUSH_TOKEN", "private-invalid-token")
    monkeypatch.setattr(setup.subprocess, "run", lambda *_a, **_k: pytest.fail("psql called"))
    assert setup.main() == 2
    output = capsys.readouterr().err
    assert "Expo push token" in output
    assert "private-invalid-token" not in output


def test_fixture_trims_pasted_token_before_seeding(monkeypatch):
    fill_environment(monkeypatch)
    monkeypatch.setenv("STAGING_CANARY_PUSH_TOKEN", " ExpoPushToken[stagingonly1234]\n")
    seen = []

    def fake_psql(_args, **kwargs):
        seen.append(kwargs["input"])
        return subprocess.CompletedProcess([], 0, "", "")

    monkeypatch.setattr(setup.subprocess, "run", fake_psql)
    assert setup.main() == 0
    assert "ExpoPushToken[stagingonly1234]" in seen[0]
    assert " ExpoPushToken[stagingonly1234]" not in seen[0]


def test_fixture_quotes_private_values_and_rejects_newlines():
    assert setup.literal("o'brien@example.test") == "'o''brien@example.test'"
    with pytest.raises(ValueError):
        setup.literal("line\nnext")


def test_secret_cleanup_refuses_production(monkeypatch):
    fill_environment(monkeypatch)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", setup.DEMO_PROJECT_REF)
    monkeypatch.setattr(secrets.subprocess, "run", lambda *_a, **_k: pytest.fail("CLI called"))
    assert secrets.cleanup() == 2


def test_secret_cleanup_unsets_only_present_canary_names(monkeypatch):
    fill_environment(monkeypatch)
    calls = []

    def fake_cli(args, **_kwargs):
        calls.append(args)
        if args[2] == "list":
            return subprocess.CompletedProcess(args, 0,
                '[{"name":"WORKER_CANARY_GENERATION_ENABLED"},'
                '{"name":"UNRELATED_SECRET"}]', "")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(secrets.subprocess, "run", fake_cli)
    assert secrets.cleanup() == 0
    assert calls[-1][0:4] == ["supabase", "secrets", "unset",
                               "WORKER_CANARY_GENERATION_ENABLED"]
    assert "UNRELATED_SECRET" not in calls[-1]


def test_gate_closure_commits_before_fixture_cleanup():
    sql = gates.cleanup_sql("ExpoPushToken[stagingonly1234]", "reviewer@example.test")
    assert sql.index("update public.edge_worker_jobs") < sql.index("commit;")
    assert sql.index("commit;") < sql.index("delete from public.device_tokens")
    assert "ExpoPushToken[stagingonly1234]" in sql


def test_provider_secrets_use_worker_only_names(monkeypatch):
    fill_environment(monkeypatch)
    for source in secrets.PRIVATE.values():
        if source not in ("STAGING_CANARY_PUSH_TOKEN", "STAGING_CANARY_REVIEWER_EMAIL"):
            monkeypatch.setenv(source, "sender@example.test" if source.endswith("FROM")
                               else "fixture-value")
    captured = []

    def fake_cli(args, **_kwargs):
        captured.append(Path(args[4]).read_text(encoding="utf-8"))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(secrets.subprocess, "run", fake_cli)
    assert secrets.configure() == 0
    assert "WORKER_CANARY_GEMINI_API_KEY=fixture-value" in captured[0]
    assert "\nGEMINI_API_KEY=" not in captured[0]
    assert "\nALLOWED_ORIGINS=" not in captured[0]

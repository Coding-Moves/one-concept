import json

import pytest
from sqlalchemy import text

from app.workers import schema_check


@pytest.mark.parametrize("value", [
    "", "not-a-url-password-marker", "sqlite:///test.db",
    "postgresql://postgres:password-marker@localhost:6543/postgres",
    "postgresql://postgres:password-marker@localhost/",
])
async def test_bad_configuration_fails_without_exposing_url(monkeypatch, capsys, value):
    monkeypatch.setenv("DIRECT_URL", value)
    assert await schema_check.main() == 1
    output = capsys.readouterr().out
    assert json.loads(output)["schema_ready"] is False
    assert "password-marker" not in output


async def test_connection_errors_are_redacted(monkeypatch, capsys):
    monkeypatch.setenv("DIRECT_URL", "postgresql://postgres:password-marker@localhost/postgres")

    def fail(*args, **kwargs):
        raise OSError("cannot connect: password-marker")

    monkeypatch.setattr(schema_check, "create_async_engine", fail)
    assert await schema_check.main() == 1
    assert json.loads(capsys.readouterr().out) == {
        "schema_ready": False, "error_type": "OSError",
    }


@pytest.mark.parametrize("suffix", ["", "?sslmode=disable"])
async def test_command_checks_target_in_read_only_transaction(database, monkeypatch, capsys, suffix):
    monkeypatch.setenv("DIRECT_URL", database + suffix)
    original = schema_check.verify_schema

    async def verify(connection):
        assert await connection.scalar(text("show transaction_read_only")) == "on"
        assert await connection.scalar(text("show transaction_isolation")) == "repeatable read"
        assert await connection.scalar(text("show statement_timeout")) == "10s"
        return await original(connection)

    monkeypatch.setattr(schema_check, "verify_schema", verify)
    assert await schema_check.main() == 0
    assert json.loads(capsys.readouterr().out) == {"schema_ready": True, "errors": []}


async def test_command_returns_failure_for_schema_drift(database, monkeypatch, capsys):
    monkeypatch.setenv("DIRECT_URL", database)

    async def drift(connection):
        return ["Missing or changed columns: concept_backlog.claimed_at"]

    monkeypatch.setattr(schema_check, "verify_schema", drift)
    assert await schema_check.main() == 1
    assert json.loads(capsys.readouterr().out)["schema_ready"] is False


def test_postgres_url_normalization():
    url = schema_check.connection_url("postgres://postgres:example@localhost:5432/postgres")
    assert url.drivername == "postgresql+asyncpg"
    assert url.port == 5432


def test_ssl_policy_is_preserved():
    url = schema_check.connection_url("postgres://postgres:example@localhost/db?sslmode=verify-full")
    assert url.query == {"ssl": "verify-full"}
    with pytest.raises(ValueError, match="Conflicting SSL"):
        schema_check.connection_url("postgresql://localhost/db?sslmode=require&ssl=disable")

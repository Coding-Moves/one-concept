"""OAuth diagnostics must disclose only bounded status and never send mail."""

import json

from tools import diagnose_staging_gmail_oauth as diagnose


def environment(monkeypatch):
    monkeypatch.setenv("STAGING_PROJECT_REF", diagnose.DEMO_PROJECT_REF)
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_CLIENT_ID", "fixture-client.apps.googleusercontent.com")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_CLIENT_SECRET", "fixture-secret")
    monkeypatch.setenv("STAGING_CANARY_GMAIL_REFRESH_TOKEN", "fixture-refresh")


class Response:
    def __init__(self, status, payload):
        self.status = status
        self.payload = json.dumps(payload).encode()

    def read(self, size):
        assert size <= 8192
        return self.payload


class Connection:
    def __init__(self, status, payload):
        self.response = Response(status, payload)
        self.requested = None
        self.closed = False

    def request(self, method, path, body, headers):
        self.requested = (method, path, body, headers)

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


def test_oauth_check_rejects_production_before_network(monkeypatch, capsys):
    environment(monkeypatch)
    monkeypatch.setenv("STAGING_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setattr(diagnose.http.client, "HTTPSConnection",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError()))
    assert diagnose.main() == 2
    assert "fixture" not in capsys.readouterr().err


def test_oauth_check_reports_safe_google_error(monkeypatch, capsys):
    environment(monkeypatch)
    connection = Connection(400, {"error": "invalid_client",
                                  "error_description": "fixture-secret must stay hidden"})
    monkeypatch.setattr(diagnose.http.client, "HTTPSConnection",
                        lambda host, timeout: connection)
    assert diagnose.main() == 1
    output = capsys.readouterr()
    assert "invalid_client" in output.err
    assert "fixture" not in output.err
    assert connection.requested[0:2] == ("POST", "/token")
    assert connection.closed


def test_format_only_reports_field_without_network_or_value(monkeypatch, capsys):
    environment(monkeypatch)
    monkeypatch.setenv("STAGING_CANARY_GMAIL_CLIENT_SECRET", " fixture-secret")
    monkeypatch.setattr(diagnose.http.client, "HTTPSConnection",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError()))
    assert diagnose.main(format_only=True) == 2
    output = capsys.readouterr()
    assert "client_secret_format" in output.err
    assert "fixture-secret" not in output.err


def test_format_only_accepts_valid_shape_without_network(monkeypatch, capsys):
    environment(monkeypatch)
    monkeypatch.setattr(diagnose.http.client, "HTTPSConnection",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError()))
    assert diagnose.main(format_only=True) == 0
    assert "credential_format_ok" in capsys.readouterr().out


def test_oauth_check_reports_valid_scope_without_token(monkeypatch, capsys):
    environment(monkeypatch)
    connection = Connection(200, {"access_token": "fixture-access-token",
                                  "scope": diagnose.SCOPE})
    monkeypatch.setattr(diagnose.http.client, "HTTPSConnection",
                        lambda host, timeout: connection)
    assert diagnose.main() == 0
    output = capsys.readouterr()
    assert "token_exchange_ok" in output.out
    assert "fixture" not in output.out
    assert connection.closed

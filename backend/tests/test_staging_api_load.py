"""The staging load probe must stay scoped and print aggregate data only."""

import io
import urllib.error

from tools import staging_api_load


def test_percentiles_use_nearest_rank():
    assert staging_api_load.percentile([5, 1, 2, 4, 3], .50) == 3
    assert staging_api_load.percentile([5, 1, 2, 4, 3], .95) == 5


def test_load_refuses_production_before_auth(monkeypatch, capsys):
    monkeypatch.setenv("STAGING_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("PRODUCTION_PROJECT_REF", "egdszjoesxlccauahmsx")
    monkeypatch.setenv("STAGING_DIRECT_URL", "private-connection")
    monkeypatch.setattr(staging_api_load, "request_json",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(
                            AssertionError("Auth must not be called")))
    assert staging_api_load.run() == 1
    assert "private-connection" not in capsys.readouterr().err


def test_http_failure_does_not_include_request_url_or_token(monkeypatch):
    def fail(*_args, **_kwargs):
        raise urllib.error.HTTPError("https://private.invalid", 503,
                                     "private upstream message", {}, io.BytesIO())

    monkeypatch.setattr(staging_api_load.urllib.request, "urlopen", fail)
    try:
        staging_api_load.fetch_state("https://private.invalid", "key", "private-token")
    except ValueError as exc:
        assert str(exc) == "Staging state returned HTTP 503"
    else:
        raise AssertionError("Expected a safe status error")

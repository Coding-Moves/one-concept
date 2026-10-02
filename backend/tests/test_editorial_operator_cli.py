import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.workers import editorial_review


async def test_operator_cli_uses_http_identity_without_redirects(monkeypatch, tmp_path):
    monkeypatch.setenv("EDITORIAL_ACCESS_TOKEN", "synthetic-mfa-token")
    body = tmp_path / "command.json"
    payload = {
        "action": "publish",
        "request_id": str(uuid4()),
        "expected_token": "a" * 64,
        "note": "Verified fixture request.",
    }
    body.write_text(json.dumps(payload))
    real_client = httpx.AsyncClient
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers["authorization"] == "Bearer synthetic-mfa-token"
        assert json.loads(request.content) == payload
        return httpx.Response(200, json={"status": "published"})

    def client(**kwargs):
        assert kwargs["follow_redirects"] is False and kwargs["trust_env"] is False
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(editorial_review.httpx, "AsyncClient", client)
    args = SimpleNamespace(
        api_url="https://api.example.invalid",
        path="/v1/editorial/revisions/fixture/actions",
        body=body,
    )
    assert await editorial_review.run(args) == {"status": "published"}
    assert len(seen) == 1
    args.api_url = "http://api.example.invalid"
    with pytest.raises(ValueError, match="HTTPS"):
        await editorial_review.run(args)
    args.api_url = "https://api.example.invalid"
    args.path = "//other.example.invalid/v1/editorial/queue"
    with pytest.raises(ValueError, match="editorial API path"):
        await editorial_review.run(args)

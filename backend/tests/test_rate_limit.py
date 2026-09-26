import uuid

from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.core.rate_limit import AccountRateLimiter
from app.deps import get_current_user
from test_security import ISSUER, _jwks_cache_with, _keypair, _token


def test_buckets_refill_isolate_methods_and_bound_memory():
    now = [0.0]
    limiter = AccountRateLimiter(2, 1, 3, clock=lambda: now[0])
    assert limiter.retry_after("a", "GET") == 0
    assert limiter.retry_after("a", "GET") == 0
    assert limiter.retry_after("a", "GET") == 30
    assert limiter.retry_after("a", "PUT") == 0
    assert limiter.retry_after("a", "DELETE") == 60
    assert limiter.retry_after("b", "GET") == 0
    assert limiter.retry_after("c", "GET") == 60
    assert len(limiter.buckets) == 3
    now[0] = 30
    assert limiter.retry_after("a", "GET") == 0
    now[0] = 91
    assert limiter.retry_after("c", "GET") == 0
    assert len(limiter.buckets) == 1


async def test_http_limits_use_verified_subject_not_spoofed_headers_or_user_id():
    private, public = _keypair()
    app = FastAPI()
    app.state.jwks = _jwks_cache_with(public)
    app.state.rate_limiter = AccountRateLimiter(1, 1, 100)
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url=ISSUER.removesuffix("/auth/v1"),
    )

    @app.api_route("/state", methods=["GET", "PUT"])
    async def state(user=Depends(get_current_user)):
        return {"user": str(user.id)}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/state")).status_code == 401
        assert not app.state.rate_limiter.buckets
        first = {"Authorization": f"Bearer {_token(private)}"}
        assert (await client.get("/state", headers=first)).status_code == 200
        spoofed = {**first, "X-Forwarded-For": "1.2.3.4", "X-User-ID": str(uuid.uuid4())}
        response = await client.get(f"/state?user_id={uuid.uuid4()}", headers=spoofed)
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "60"
        assert response.json()["detail"]["code"] == "rate_limited"
        second = {"Authorization": f"Bearer {_token(private, sub=str(uuid.uuid4()))}"}
        assert (await client.get("/state", headers=second)).status_code == 200
        assert (await client.put("/state", headers=first)).status_code == 200
        assert (await client.put("/state", headers=first)).status_code == 429

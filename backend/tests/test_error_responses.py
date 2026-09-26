from types import SimpleNamespace

import pytest
from sqlalchemy.exc import OperationalError

from app.core.exception_handlers import database_unavailable, unexpected_failure


@pytest.mark.asyncio
async def test_database_failure_is_a_retryable_sanitized_response():
    response = await database_unavailable(
        SimpleNamespace(), OperationalError("select 1", {}, Exception("postgres://secret@host"))
    )

    assert response.status_code == 503
    assert response.headers["retry-after"] == "30"
    assert response.headers["cache-control"] == "no-store"
    body = response.body.decode()
    assert '"code":"service_unavailable"' in body
    assert "secret" not in body and "postgres" not in body
    assert response.headers["x-incident-id"] in body


@pytest.mark.asyncio
async def test_unexpected_failure_never_returns_exception_text():
    response = await unexpected_failure(SimpleNamespace(), RuntimeError("token=private-value"))

    assert response.status_code == 500
    body = response.body.decode()
    assert '"code":"internal_error"' in body
    assert "private-value" not in body
    assert response.headers["x-incident-id"] in body

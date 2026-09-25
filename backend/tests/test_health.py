import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.api.v1.health import health
from app.config import Settings


async def test_health_bounds_stalled_queries():
    class Stalled:
        async def execute(self, _query):
            await asyncio.sleep(10)

    with pytest.raises(HTTPException) as exc:
        await health(Stalled(), Settings(db_keepalive_timeout_seconds=0.01))
    assert exc.value.status_code == 503


async def test_health_hides_connection_details():
    class Failed:
        async def execute(self, _query):
            raise OperationalError("secret connection string", {}, Exception("password"))

    with pytest.raises(HTTPException) as exc:
        await health(Failed(), Settings())
    assert exc.value.detail == "Database unavailable"

import asyncio
import json
import time

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.api.v1.health import health, operations_health
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


async def test_external_monitor_rejects_missing_stale_or_wrong_revision_heartbeats(tmp_path):
    path = tmp_path / 'health.json'
    settings = Settings(operations_status_file=str(path), app_revision='a' * 40)
    for body in [None, {'status': 'degraded', 'revision': 'a' * 40, 'checked_at': time.time()},
                 {'status': 'ok', 'revision': 'b' * 40, 'checked_at': time.time()},
                 {'status': 'ok', 'revision': 'a' * 40, 'checked_at': time.time() - 601}]:
        if body:
            path.write_text(json.dumps(body))
        with pytest.raises(HTTPException) as exc:
            await operations_health(settings)
        assert exc.value.status_code == 503
    path.write_text(json.dumps({'status': 'ok', 'revision': 'a' * 40, 'checked_at': time.time()}))
    assert await operations_health(settings) == {'status': 'ok', 'revision': 'a' * 40}

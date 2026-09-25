"""Protected pre-deploy check: python -m app.workers.schema_check.

No migrations, registry writes, seeds or production data reads are performed.
Use DIRECT_URL (session pooler, never transaction port 6543).
"""

import asyncio
import json
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db.schema import verify_schema


async def main() -> int:
    settings = get_settings()
    url = settings.direct_url or ""
    if not url or urlsplit(url).port == 6543:
        print("Schema verification requires DIRECT_URL using the session connection")
        return 1
    url = url.replace("postgres://", "postgresql://", 1)
    url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    engine = create_async_engine(url, poolclass=NullPool, connect_args={"timeout": 10})
    try:
        async with asyncio.timeout(45):
            async with engine.connect() as connection:
                async with connection.begin():
                    await connection.execute(text("set transaction isolation level repeatable read, read only"))
                    await connection.execute(text("set local statement_timeout = '10s'"))
                    errors = await verify_schema(connection)
        print(json.dumps({"revision": settings.app_revision, "schema_ready": not errors, "errors": errors}))
        return int(bool(errors))
    except Exception as exc:
        # Connection exceptions can contain credentials/DSNs. Never print them.
        print(json.dumps({"schema_ready": False, "error_type": type(exc).__name__}))
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

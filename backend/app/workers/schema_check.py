"""Read-only target verification: python -m app.workers.schema_check.

Only DIRECT_URL is needed; no application keys or user records are accessed.
Use a direct/session connection, never the transaction pooler on port 6543.
"""

import asyncio
import json
import os

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.db.schema import verify_schema


def connection_url(value: str):
    url = make_url(value.replace("postgres://", "postgresql://", 1))
    if url.drivername not in {"postgresql", "postgresql+asyncpg"}:
        raise ValueError("Expected PostgreSQL")
    if not url.host or not url.database or url.port == 6543:
        raise ValueError("Expected direct/session connection")
    return url.set(drivername="postgresql+asyncpg")


async def main() -> int:
    # Do not load .env or application settings: release CI needs only one secret.
    # Parse/connect errors can contain a password, so never print their messages.
    engine = None
    try:
        url = connection_url(os.environ.get("DIRECT_URL", ""))
        engine = create_async_engine(
            url, poolclass=NullPool, connect_args={"timeout": 10},
        )
        async with asyncio.timeout(45):
            async with engine.connect() as connection:
                async with connection.begin():
                    await connection.execute(text(
                        "set transaction isolation level repeatable read, read only"
                    ))
                    await connection.execute(text("set local statement_timeout = '10s'"))
                    errors = await verify_schema(connection)
        print(json.dumps({"schema_ready": not errors, "errors": errors}))
        return int(bool(errors))
    except Exception as exc:
        print(json.dumps({"schema_ready": False, "error_type": type(exc).__name__}))
        return 1
    finally:
        if engine is not None:
            await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

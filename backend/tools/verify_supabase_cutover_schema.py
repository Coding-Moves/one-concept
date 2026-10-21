"""Read-only production cutover guard for the API and worker SQL contract.

Run after the ordered production migrations and before deploying Edge code.
Never print the connection URL or database exception details.
"""

import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.workers.schema_check import connection_url


async def main() -> int:
    engine = None
    try:
        engine = create_async_engine(
            connection_url(os.environ.get("DIRECT_URL", "")),
            poolclass=NullPool,
            connect_args={"timeout": 10},
        )
        async with asyncio.timeout(45):
            async with engine.connect() as connection:
                async with connection.begin():
                    await connection.execute(text(
                        "set transaction isolation level repeatable read, read only"
                    ))
                    await connection.execute(text("set local statement_timeout = '10s'"))
                    ready = await connection.scalar(text("""
                        select to_regclass('public.edge_worker_jobs') is not null
                          and to_regclass('public.edge_worker_runs') is not null
                          and to_regprocedure('public.edge_api_public_profile(text)') is not null
                          and to_regprocedure('public.edge_worker_enqueue_run(text,timestamptz)') is not null
                          and to_regprocedure('public.edge_worker_expire_runs()') is not null
                          and to_regprocedure('public.edge_worker_claim_email(integer)') is not null
                          and position('delivery_unknown' in coalesce(pg_get_functiondef(
                            to_regprocedure('public.edge_worker_claim_email(integer)')), '')) > 0
                    """))
        print("supabase_cutover_schema=" + ("ready" if ready else "missing"))
        return 0 if ready else 1
    except Exception as exc:
        print("supabase_cutover_schema=error:" + type(exc).__name__)
        return 1
    finally:
        if engine is not None:
            await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

# A transaction-mode pooler hands each transaction a different backend, so
# server-side prepared statements and client-side pooling must both be off.
_connect_args: dict = {}
_engine_kwargs: dict = {}
if settings.uses_transaction_pooler:
    _connect_args["statement_cache_size"] = 0
    _engine_kwargs["poolclass"] = NullPool
    _engine_kwargs["execution_options"] = {"compiled_cache": None}

engine = create_async_engine(
    settings.sqlalchemy_url,
    echo=False,
    pool_pre_ping=True,
    connect_args=_connect_args,
    **_engine_kwargs,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

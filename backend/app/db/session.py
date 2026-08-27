from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

# A transaction-mode pooler hands each transaction a different backend, so
# server-side prepared statements must be off. Client-side pooling, though,
# is not only safe but necessary: without it every request pays a fresh
# TCP + TLS + auth handshake to the database region, which dominates response
# time when the database is far away.
_connect_args: dict = {}
if settings.uses_transaction_pooler:
    _connect_args["statement_cache_size"] = 0

engine = create_async_engine(
    settings.sqlalchemy_url,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_recycle=1800,
    pool_pre_ping=True,
    connect_args=_connect_args,
    execution_options={"compiled_cache": None} if settings.uses_transaction_pooler else {},
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

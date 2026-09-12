from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings, get_settings

settings = get_settings()

# A transaction-mode pooler hands each transaction a different backend, so
# server-side prepared statements must be off. Client-side pooling, though,
# is not only safe but necessary: without it every request pays a fresh
# TCP + TLS + auth handshake to the database region, which dominates response
# time when the database is far away.
def create_db_engine(config: Settings) -> AsyncEngine:
    connect_args = {"statement_cache_size": 0} if config.uses_transaction_pooler else {}
    return create_async_engine(
        config.sqlalchemy_url,
        echo=False,
        pool_size=5,
        max_overflow=5,
        pool_recycle=1800,
        pool_pre_ping=True,
        # Keep the most recently used connection hot instead of cycling through
        # every idle slot. Other slots still reconnect safely on demand.
        pool_use_lifo=True,
        connect_args=connect_args,
        execution_options={"compiled_cache": None} if config.uses_transaction_pooler else {},
    )


engine = create_db_engine(settings)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

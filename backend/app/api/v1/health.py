import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(
    db: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings),
) -> dict:
    """Bounded database readiness and safe immutable revision evidence."""
    try:
        async with asyncio.timeout(settings.db_keepalive_timeout_seconds):
            await db.execute(text("select 1"))
    except (TimeoutError, SQLAlchemyError):
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ok", "database": "reachable", "revision": settings.app_revision}

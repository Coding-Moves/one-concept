import asyncio
import json
from pathlib import Path
import time

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


@router.get("/health/operations")
async def operations_health(settings: Settings = Depends(get_settings)) -> dict:
    """Safe host-written aggregate. No credentials, user IDs or job output."""
    if not settings.operations_status_file:
        raise HTTPException(status_code=503, detail="Operational monitoring not configured")
    try:
        status = json.loads(Path(settings.operations_status_file).read_text())
        age = time.time() - status["checked_at"]
        ready = status["status"] == "ok" and status["revision"] == settings.app_revision and 0 <= age <= 600
    except (OSError, ValueError, KeyError, TypeError):
        ready = False
    if not ready:
        raise HTTPException(status_code=503, detail="Operational verification required")
    return {"status": "ok", "revision": settings.app_revision}

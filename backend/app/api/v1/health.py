from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    """Liveness plus a real query.

    This is also the endpoint a cron job pings to stop a free-tier Supabase
    project pausing after a week of inactivity, so it must touch the database
    rather than just returning 200.
    """
    await db.execute(text("select 1"))
    return {"status": "ok", "database": "reachable"}

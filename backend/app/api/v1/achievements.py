from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.achievements import AchievementsOut, AcknowledgeIn
from app.services.achievements import acknowledge, collection
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/me/achievements", tags=["achievements"])


@router.get("", response_model=AchievementsOut)
async def get_achievements(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await ensure_bootstrapped(db, user.id, user.email)
    result = await collection(db, user.id)
    await db.commit()
    return result


@router.post("/seen", status_code=204)
async def mark_seen(
    body: AcknowledgeIn,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await acknowledge(db, user.id, body.codes)
    await db.commit()
    return Response(status_code=204)

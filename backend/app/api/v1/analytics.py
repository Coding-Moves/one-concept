from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.analytics import AnalyticsOut
from app.services.analytics import analytics
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/me/analytics", tags=["analytics"])


@router.get("", response_model=AnalyticsOut)
async def get_analytics(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
) -> AnalyticsOut:
    await ensure_bootstrapped(db, user.id, user.email)
    result = await analytics(db, user.id)
    await db.commit()
    return result

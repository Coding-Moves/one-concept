import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.me import CompletedOut, StreakOut
from app.services.reviews import complete_review
from app.services.streaks import compute_streaks

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("/{review_id}/complete", response_model=CompletedOut)
async def complete(
    review_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    day = await complete_review(db, user.id, review_id)
    return CompletedOut(
        completed=True,
        assigned_for=day,
        stats=StreakOut(**vars(await compute_streaks(db, user.id))),
    )

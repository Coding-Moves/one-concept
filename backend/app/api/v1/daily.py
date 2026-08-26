from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.daily import ConceptOut, DailyExhaustedOut, DailyOut
from app.services.selection import get_or_create_daily
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/daily", tags=["daily"])


@router.get(
    "",
    response_model=DailyOut,
    responses={200: {"model": DailyOut}, 409: {"model": DailyExhaustedOut}},
)
async def get_daily(
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Today's concept, creating the assignment on first call of the day.

    Idempotent: every later call the same day returns the same concept without
    writing anything.
    """
    await ensure_bootstrapped(db, user.id, user.email)
    await db.commit()

    result = await get_or_create_daily(db, user.id)

    if result.status == "exhausted":
        response.status_code = status.HTTP_409_CONFLICT
        return DailyExhaustedOut(assigned_for=result.assigned_for)

    concept = result.concept
    return DailyOut(
        assigned_for=result.assigned_for,
        assigned_at=result.assigned_at,
        completed_at=result.completed_at,
        learned=result.completed_at is not None,
        outside_followed_topics=result.outside_followed_topics,
        concept=ConceptOut(
            id=concept.id,
            slug=concept.slug,
            title=concept.title,
            summary=concept.summary,
            example=concept.example,
            topic_slug=concept.topic_slug,
            topic_name=concept.topic_name,
        ),
    )

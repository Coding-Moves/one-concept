from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.subtopics import (
    AcknowledgeSubtopicCompletionsIn,
    SubtopicProgressCollectionOut,
    SubtopicProgressOut,
)
from app.services.subtopic_progress import acknowledge, progress
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/me/subtopics", tags=["subtopics"])


@router.get("/progress", response_model=SubtopicProgressCollectionOut)
async def get_progress(
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
) -> SubtopicProgressCollectionOut:
    await ensure_bootstrapped(db, user.id, user.email)
    await db.commit()
    return SubtopicProgressCollectionOut(
        items=[SubtopicProgressOut(**vars(item)) for item in await progress(db, user.id)]
    )


@router.post("/completions/seen", status_code=204)
async def mark_completions_seen(
    body: AcknowledgeSubtopicCompletionsIn,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
) -> Response:
    await acknowledge(db, user.id, body.ids)
    await db.commit()
    return Response(status_code=204)

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.quizzes import (
    WeeklyQuizAttemptOut,
    WeeklyQuizOut,
    WeeklyQuizSubmissionIn,
    WeeklyQuizUnavailableOut,
)
from app.services.users import ensure_bootstrapped
from app.services.weekly_quizzes import get_or_create_weekly_quiz, submit_weekly_quiz

router = APIRouter(prefix="/quizzes", tags=["quizzes"])


@router.get("/weekly", response_model=WeeklyQuizOut | WeeklyQuizUnavailableOut)
async def weekly_quiz(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await ensure_bootstrapped(db, user.id, user.email)
    quiz = await get_or_create_weekly_quiz(db, user.id)
    await db.commit()
    return quiz


@router.post("/weekly/{quiz_id}/attempts", response_model=WeeklyQuizAttemptOut)
async def submit(
    quiz_id: uuid.UUID,
    body: WeeklyQuizSubmissionIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        attempt = await submit_weekly_quiz(db, user.id, quiz_id, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    await db.commit()
    return attempt

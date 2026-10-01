import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.subtopic_quizzes import (
    SubtopicQuizAttemptHistoryOut,
    SubtopicQuizAttemptOut,
    SubtopicQuizOut,
    SubtopicQuizSubmissionIn,
    SubtopicQuizUnavailableOut,
)
from app.services.subtopic_quizzes import (
    get_or_create_subtopic_quiz,
    submit_subtopic_quiz,
    subtopic_quiz_history,
)
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/quizzes/subtopics", tags=["subtopic quizzes"])


@router.get("/{completion_id}", response_model=SubtopicQuizOut | SubtopicQuizUnavailableOut)
async def subtopic_quiz(
    completion_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    await ensure_bootstrapped(db, user.id, user.email)
    try:
        quiz = await get_or_create_subtopic_quiz(db, user.id, completion_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    await db.commit()
    return quiz


@router.get("/{completion_id}/attempts", response_model=SubtopicQuizAttemptHistoryOut)
async def attempts(
    completion_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    return await subtopic_quiz_history(db, user.id, completion_id)


@router.post("/{quiz_id}/attempts", response_model=SubtopicQuizAttemptOut)
async def submit(
    quiz_id: uuid.UUID,
    body: SubtopicQuizSubmissionIn,
    user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    try:
        attempt = await submit_subtopic_quiz(db, user.id, quiz_id, body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    await db.commit()
    return attempt

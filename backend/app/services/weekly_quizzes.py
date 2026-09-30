"""Server-owned weekly quiz selection and immutable attempt recording.

The lesson review gate creates three MCQs. This service freezes one reviewed
MCQ from seven already-completed concepts into a per-user weekly snapshot, so a
later editorial correction cannot silently change an in-progress quiz.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.quizzes import (
    WeeklyQuizAnswerResult,
    WeeklyQuizAttemptOut,
    WeeklyQuizOut,
    WeeklyQuizQuestionOut,
    WeeklyQuizSubmissionIn,
    WeeklyQuizUnavailableOut,
)
from app.services.content_quality import MultipleChoiceQuestion

QUESTIONS_PER_WEEK = 7


@dataclass(frozen=True)
class _Question:
    id: str
    concept_slug: str
    concept_title: str
    content_version: int
    question: str
    options: list[str]
    correct_index: int


_PROFILE_LOCK = text("""
    select id from public.profiles where id=:uid for update
""")
_EXISTING = text("""
    select id, questions from public.weekly_quizzes
     where user_id=:uid and week_start=:week_start
""")
_CANDIDATES = text("""
    select c.id,c.slug,c.title,c.content_version,c.mcqs,max(a.completed_at) as completed_at
      from public.daily_assignments a
      join public.concepts c on c.id=a.concept_id
     where a.user_id=:uid and a.completed_at is not null
       and c.status='published' and jsonb_typeof(c.mcqs)='array'
     group by c.id,c.slug,c.title,c.content_version,c.mcqs
    having jsonb_array_length(c.mcqs) = 3
     order by max(a.completed_at) desc, c.id
     limit :limit
""")
_INSERT_QUIZ = text("""
    insert into public.weekly_quizzes (user_id,week_start,questions)
    values (:uid,:week_start,cast(:questions as jsonb))
    returning id
""")
_QUIZ_FOR_SUBMISSION = text("""
    select id,week_start,questions from public.weekly_quizzes
     where id=:quiz_id and user_id=:uid
     for update
""")
_INSERT_ATTEMPT = text("""
    insert into public.weekly_quiz_attempts (quiz_id,user_id,answers,correct_count)
    values (:quiz_id,:uid,cast(:answers as jsonb),:correct_count)
    returning id,attempted_at
""")


def _week_start(today: date) -> date:
    return today - timedelta(days=today.weekday())


def _question_index(user_id: uuid.UUID, week_start: date, concept_id: uuid.UUID) -> int:
    digest = hashlib.sha256(
        f"{user_id}:{week_start.isoformat()}:{concept_id}".encode()
    ).digest()
    return int.from_bytes(digest[:2], "big") % 3


def _snapshot_question(row, user_id: uuid.UUID, week_start: date) -> _Question:
    index = _question_index(user_id, week_start, row.id)
    mcq = MultipleChoiceQuestion.model_validate(row.mcqs[index])
    return _Question(
        id=f"{row.id}:{row.content_version}:{index}",
        concept_slug=row.slug,
        concept_title=row.title,
        content_version=row.content_version,
        question=mcq.question,
        options=mcq.options,
        correct_index=mcq.correct_index,
    )


def _public_question(question: _Question | dict) -> WeeklyQuizQuestionOut:
    values = question if isinstance(question, dict) else vars(question)
    return WeeklyQuizQuestionOut(
        **{
            key: values[key]
            for key in (
                "id",
                "concept_slug",
                "concept_title",
                "content_version",
                "question",
                "options",
            )
        }
    )


async def get_or_create_weekly_quiz(
    session: AsyncSession, user_id: uuid.UUID
) -> WeeklyQuizOut | WeeklyQuizUnavailableOut:
    """Return this stable ISO week's frozen quiz, or an honest eligibility state."""
    # Daily lessons use the learner's wall-clock timezone. A quiz belongs to a
    # shared ISO week instead: profile timezones may change automatically when
    # a learner travels, and a changed timezone must not mint another quiz.
    await session.execute(_PROFILE_LOCK, {"uid": user_id})
    week_start = _week_start(await session.scalar(text("select current_date")))
    existing = (
        await session.execute(_EXISTING, {"uid": user_id, "week_start": week_start})
    ).first()
    if existing is not None:
        return WeeklyQuizOut(
            quiz_id=existing.id,
            week_start=week_start,
            questions=[_public_question(question) for question in existing.questions],
        )

    candidates = (
        await session.execute(
            _CANDIDATES, {"uid": user_id, "limit": QUESTIONS_PER_WEEK}
        )
    ).all()
    if len(candidates) < QUESTIONS_PER_WEEK:
        return WeeklyQuizUnavailableOut(
            week_start=week_start,
            available_concepts=len(candidates),
            detail="Complete more concepts with reviewed questions to unlock this weekly quiz.",
        )

    questions = [_snapshot_question(row, user_id, week_start) for row in candidates]
    serializable = [vars(question) for question in questions]
    quiz_id = await session.scalar(
        _INSERT_QUIZ,
        {
            "uid": user_id,
            "week_start": week_start,
            "questions": json.dumps(serializable),
        },
    )
    return WeeklyQuizOut(
        quiz_id=quiz_id,
        week_start=week_start,
        questions=[_public_question(question) for question in questions],
    )


async def submit_weekly_quiz(
    session: AsyncSession,
    user_id: uuid.UUID,
    quiz_id: uuid.UUID,
    submission: WeeklyQuizSubmissionIn,
) -> WeeklyQuizAttemptOut:
    """Score only the frozen server snapshot and append one immutable attempt."""
    quiz = (
        await session.execute(
            _QUIZ_FOR_SUBMISSION, {"quiz_id": quiz_id, "uid": user_id}
        )
    ).first()
    if quiz is None:
        raise ValueError("Weekly quiz not found")
    questions = quiz.questions
    by_id = {question["id"]: question for question in questions}
    submitted = {
        answer.question_id: answer.selected_index for answer in submission.answers
    }
    if set(submitted) != set(by_id):
        raise ValueError("Answers must match this quiz exactly")

    results = [
        WeeklyQuizAnswerResult(
            question_id=question_id,
            selected_index=submitted[question_id],
            correct_index=question["correct_index"],
            correct=submitted[question_id] == question["correct_index"],
        )
        for question_id, question in by_id.items()
    ]
    correct_count = sum(result.correct for result in results)
    attempt = (
        await session.execute(
            _INSERT_ATTEMPT,
            {
                "quiz_id": quiz.id,
                "uid": user_id,
                "answers": json.dumps(
                    [
                        {
                            "question_id": result.question_id,
                            "selected_index": result.selected_index,
                        }
                        for result in results
                    ]
                ),
                "correct_count": correct_count,
            },
        )
    ).one()
    return WeeklyQuizAttemptOut(
        attempt_id=attempt.id,
        quiz_id=quiz.id,
        week_start=quiz.week_start,
        attempted_at=attempt.attempted_at,
        correct_count=correct_count,
        results=results,
    )

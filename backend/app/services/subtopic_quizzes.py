"""Optional, server-owned quizzes for immutable subtopic completion events."""

import hashlib
import json
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.subtopic_quizzes import (
    SubtopicQuizAnswerResult,
    SubtopicQuizAttemptHistoryOut,
    SubtopicQuizAttemptOut,
    SubtopicQuizAttemptSummaryOut,
    SubtopicQuizOut,
    SubtopicQuizQuestionOut,
    SubtopicQuizSubmissionIn,
    SubtopicQuizUnavailableOut,
)
from app.services.content_quality import MultipleChoiceQuestion

MAX_QUESTIONS = 7


@dataclass(frozen=True)
class _Question:
    id: str
    concept_slug: str
    concept_title: str
    content_version: int
    question: str
    options: list[str]
    correct_index: int


_PROFILE_LOCK = text("select id from public.profiles where id=:uid for update")
_EXISTING = text("""
    select q.id,q.questions,e.id as completion_id,t.name as topic_name,s.name as subtopic_name
      from public.subtopic_quizzes q
      join public.user_subtopic_completions e on e.id=q.subtopic_completion_id
      join public.subtopics s on s.id=e.subtopic_id
      join public.topics t on t.id=s.topic_id
     where q.user_id=:uid and q.subtopic_completion_id=:completion_id
""")
_COMPLETION = text("""
    select e.id as completion_id,e.catalog_concept_ids,t.name as topic_name,s.name as subtopic_name
      from public.user_subtopic_completions e
      join public.subtopics s on s.id=e.subtopic_id
      join public.topics t on t.id=s.topic_id
     where e.id=:completion_id and e.user_id=:uid
""")
_CANDIDATES = text("""
    select c.id,c.slug,c.title,c.content_version,c.mcqs
      from public.concepts c
     where c.id=any(cast(:concept_ids as uuid[]))
       and c.status='published'
       and jsonb_typeof(c.mcqs)='array'
       and jsonb_array_length(c.mcqs)=3
""")
_INSERT_QUIZ = text("""
    insert into public.subtopic_quizzes (user_id,subtopic_completion_id,questions)
    values (:uid,:completion_id,cast(:questions as jsonb))
    on conflict (user_id,subtopic_completion_id) do nothing
    returning id
""")
_QUIZ_FOR_SUBMISSION = text("""
    select q.id,q.subtopic_completion_id,q.questions
      from public.subtopic_quizzes q
     where q.id=:quiz_id and q.user_id=:uid
     for update
""")
_INSERT_ATTEMPT = text("""
    insert into public.subtopic_quiz_attempts (quiz_id,user_id,answers,correct_count)
    values (:quiz_id,:uid,cast(:answers as jsonb),:correct_count)
    returning id,attempted_at
""")
_HISTORY = text("""
    select a.id,a.attempted_at,a.correct_count,jsonb_array_length(q.questions) as question_count
      from public.subtopic_quiz_attempts a
      join public.subtopic_quizzes q on q.id=a.quiz_id
     where q.user_id=:uid and q.subtopic_completion_id=:completion_id
     order by a.attempted_at desc,a.id desc
     limit 50
""")


def _question_index(completion_id: uuid.UUID, concept_id: uuid.UUID) -> int:
    digest = hashlib.sha256(f"{completion_id}:{concept_id}".encode()).digest()
    return int.from_bytes(digest[:2], "big") % 3


def _candidate_order(completion_id: uuid.UUID, concept_id: uuid.UUID) -> bytes:
    return hashlib.sha256(f"{completion_id}:select:{concept_id}".encode()).digest()


def _snapshot_question(row, completion_id: uuid.UUID) -> _Question:
    index = _question_index(completion_id, row.id)
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


def _public_question(question: _Question | dict) -> SubtopicQuizQuestionOut:
    values = question if isinstance(question, dict) else vars(question)
    return SubtopicQuizQuestionOut(**{
        key: values[key]
        for key in ("id", "concept_slug", "concept_title", "content_version", "question", "options")
    })


async def get_or_create_subtopic_quiz(
    session: AsyncSession, user_id: uuid.UUID, completion_id: uuid.UUID,
) -> SubtopicQuizOut | SubtopicQuizUnavailableOut:
    """Freeze one optional quiz against the caller's exact completed catalog."""
    await session.execute(_PROFILE_LOCK, {"uid": user_id})
    existing = (await session.execute(
        _EXISTING, {"uid": user_id, "completion_id": completion_id}
    )).first()
    if existing is not None:
        return SubtopicQuizOut(
            quiz_id=existing.id, completion_id=existing.completion_id,
            topic_name=existing.topic_name, subtopic_name=existing.subtopic_name,
            questions=[_public_question(question) for question in existing.questions],
        )

    completion = (await session.execute(
        _COMPLETION, {"uid": user_id, "completion_id": completion_id}
    )).first()
    if completion is None:
        raise ValueError("Completed subtopic not found")

    candidates = (await session.execute(
        _CANDIDATES, {"concept_ids": completion.catalog_concept_ids}
    )).all()
    required = min(MAX_QUESTIONS, len(completion.catalog_concept_ids))
    if len(candidates) < required:
        return SubtopicQuizUnavailableOut(
            completion_id=completion.completion_id,
            topic_name=completion.topic_name,
            subtopic_name=completion.subtopic_name,
            reviewed_concepts=len(candidates), required_concepts=required,
            detail="This optional quiz will unlock when enough reviewed questions are available.",
        )

    selected = sorted(candidates, key=lambda row: _candidate_order(completion_id, row.id))[:required]
    questions = [_snapshot_question(row, completion_id) for row in selected]
    quiz_id = await session.scalar(_INSERT_QUIZ, {
        "uid": user_id, "completion_id": completion_id,
        "questions": json.dumps([vars(question) for question in questions]),
    })
    if quiz_id is None:
        existing = (await session.execute(
            _EXISTING, {"uid": user_id, "completion_id": completion_id}
        )).one()
        return SubtopicQuizOut(
            quiz_id=existing.id, completion_id=existing.completion_id,
            topic_name=existing.topic_name, subtopic_name=existing.subtopic_name,
            questions=[_public_question(question) for question in existing.questions],
        )
    return SubtopicQuizOut(
        quiz_id=quiz_id, completion_id=completion.completion_id,
        topic_name=completion.topic_name, subtopic_name=completion.subtopic_name,
        questions=[_public_question(question) for question in questions],
    )


async def submit_subtopic_quiz(
    session: AsyncSession, user_id: uuid.UUID, quiz_id: uuid.UUID,
    submission: SubtopicQuizSubmissionIn,
) -> SubtopicQuizAttemptOut:
    """Score one retry safely and append its result without changing history."""
    quiz = (await session.execute(
        _QUIZ_FOR_SUBMISSION, {"uid": user_id, "quiz_id": quiz_id}
    )).first()
    if quiz is None:
        raise ValueError("Subtopic quiz not found")
    by_id = {question["id"]: question for question in quiz.questions}
    submitted = {answer.question_id: answer.selected_index for answer in submission.answers}
    if set(submitted) != set(by_id):
        raise ValueError("Answers must match this quiz exactly")
    results = [
        SubtopicQuizAnswerResult(
            question_id=question_id, selected_index=submitted[question_id],
            correct_index=question["correct_index"],
            correct=submitted[question_id] == question["correct_index"],
        )
        for question_id, question in by_id.items()
    ]
    correct_count = sum(item.correct for item in results)
    attempt = (await session.execute(_INSERT_ATTEMPT, {
        "quiz_id": quiz.id, "uid": user_id,
        "answers": json.dumps([
            {"question_id": item.question_id, "selected_index": item.selected_index}
            for item in results
        ]),
        "correct_count": correct_count,
    })).one()
    return SubtopicQuizAttemptOut(
        attempt_id=attempt.id, quiz_id=quiz.id, completion_id=quiz.subtopic_completion_id,
        attempted_at=attempt.attempted_at, correct_count=correct_count,
        question_count=len(results), results=results,
    )


async def subtopic_quiz_history(
    session: AsyncSession, user_id: uuid.UUID, completion_id: uuid.UUID,
) -> SubtopicQuizAttemptHistoryOut:
    completion = (await session.execute(
        _COMPLETION, {"uid": user_id, "completion_id": completion_id}
    )).first()
    if completion is None:
        raise ValueError("Completed subtopic not found")
    rows = (await session.execute(
        _HISTORY, {"uid": user_id, "completion_id": completion_id}
    )).all()
    return SubtopicQuizAttemptHistoryOut(items=[
        SubtopicQuizAttemptSummaryOut(
            attempt_id=row.id, attempted_at=row.attempted_at,
            correct_count=row.correct_count, question_count=row.question_count,
        ) for row in rows
    ])

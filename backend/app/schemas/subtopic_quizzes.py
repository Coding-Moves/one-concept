import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class SubtopicQuizQuestionOut(BaseModel):
    id: str
    concept_slug: str
    concept_title: str
    content_version: int
    question: str
    options: list[str] = Field(min_length=4, max_length=4)


class SubtopicQuizOut(BaseModel):
    available: bool = True
    quiz_id: uuid.UUID
    completion_id: uuid.UUID
    topic_name: str
    subtopic_name: str
    questions: list[SubtopicQuizQuestionOut] = Field(min_length=1, max_length=7)


class SubtopicQuizUnavailableOut(BaseModel):
    available: bool = False
    completion_id: uuid.UUID
    topic_name: str
    subtopic_name: str
    reviewed_concepts: int
    required_concepts: int
    detail: str


class SubtopicQuizAnswerIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)
    selected_index: int = Field(ge=0, le=3)


class SubtopicQuizSubmissionIn(BaseModel):
    answers: list[SubtopicQuizAnswerIn] = Field(min_length=1, max_length=7)

    @model_validator(mode="after")
    def answers_must_name_each_question_once(self):
        if len({answer.question_id for answer in self.answers}) != len(self.answers):
            raise ValueError("Submit one answer for each quiz question")
        return self


class SubtopicQuizAnswerResult(BaseModel):
    question_id: str
    selected_index: int
    correct_index: int
    correct: bool


class SubtopicQuizAttemptOut(BaseModel):
    attempt_id: uuid.UUID
    quiz_id: uuid.UUID
    completion_id: uuid.UUID
    attempted_at: datetime
    correct_count: int = Field(ge=0, le=7)
    question_count: int = Field(ge=1, le=7)
    results: list[SubtopicQuizAnswerResult] = Field(min_length=1, max_length=7)


class SubtopicQuizAttemptSummaryOut(BaseModel):
    attempt_id: uuid.UUID
    attempted_at: datetime
    correct_count: int = Field(ge=0, le=7)
    question_count: int = Field(ge=1, le=7)


class SubtopicQuizAttemptHistoryOut(BaseModel):
    items: list[SubtopicQuizAttemptSummaryOut]

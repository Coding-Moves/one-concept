import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator


class WeeklyQuizQuestionOut(BaseModel):
    id: str
    concept_slug: str
    concept_title: str
    content_version: int
    question: str
    options: list[str] = Field(min_length=4, max_length=4)


class WeeklyQuizOut(BaseModel):
    available: bool = True
    quiz_id: uuid.UUID
    week_start: date
    questions: list[WeeklyQuizQuestionOut] = Field(min_length=7, max_length=7)


class WeeklyQuizUnavailableOut(BaseModel):
    available: bool = False
    week_start: date
    required_concepts: int = 7
    available_concepts: int
    detail: str


class WeeklyQuizAnswerIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=200)
    selected_index: int = Field(ge=0, le=3)


class WeeklyQuizSubmissionIn(BaseModel):
    answers: list[WeeklyQuizAnswerIn] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def answers_must_match_each_question_once(self):
        if len({answer.question_id for answer in self.answers}) != len(self.answers):
            raise ValueError("Submit one answer for each quiz question")
        return self


class WeeklyQuizAnswerResult(BaseModel):
    question_id: str
    selected_index: int
    correct_index: int
    correct: bool


class WeeklyQuizAttemptOut(BaseModel):
    attempt_id: uuid.UUID
    quiz_id: uuid.UUID
    week_start: date
    attempted_at: datetime
    correct_count: int = Field(ge=0, le=7)
    results: list[WeeklyQuizAnswerResult] = Field(min_length=7, max_length=7)

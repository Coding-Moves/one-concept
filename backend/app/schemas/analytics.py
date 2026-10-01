from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.achievements import AchievementOut
from app.schemas.subtopics import SubtopicProgressOut


class AnalyticsRecentConceptOut(BaseModel):
    concept_slug: str
    title: str
    topic_name: str
    completed_at: datetime


class AnalyticsQuizAttemptOut(BaseModel):
    week_start: date
    attempted_at: datetime
    correct_count: int = Field(ge=0, le=7)
    question_count: int = Field(ge=1, le=7)


class AnalyticsActivityDayOut(BaseModel):
    day: date
    concepts: int = Field(ge=0)
    reviews: int = Field(ge=0)
    quizzes: int = Field(ge=0)


class AnalyticsTopicOut(BaseModel):
    topic_slug: str
    topic_name: str
    completed_concepts: int = Field(ge=0)


class AnalyticsOut(BaseModel):
    total_concepts: int = Field(ge=0)
    total_reviews: int = Field(ge=0)
    weekly_quiz_attempts: int = Field(ge=0)
    correct_answers: int = Field(ge=0)
    answered_questions: int = Field(ge=0)
    current_streak: int = Field(ge=0)
    longest_streak: int = Field(ge=0)
    active_days: int = Field(ge=0)
    recent_concepts: list[AnalyticsRecentConceptOut]
    recent_quizzes: list[AnalyticsQuizAttemptOut]
    activity: list[AnalyticsActivityDayOut]
    topics: list[AnalyticsTopicOut]
    subtopics: list[SubtopicProgressOut]
    achievements: list[AchievementOut]

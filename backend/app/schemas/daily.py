import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class ReviewAttributionOut(BaseModel):
    name: str
    reviewed_at: datetime
    content_version: int


class ConceptOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    summary: str
    example: str | None = None
    flashcard: dict[str, str] | None = None
    topic_slug: str
    topic_name: str
    subtopic_slug: str
    subtopic_name: str
    # Likes from other users; the client adds the viewer's own like.
    like_count: int = 0
    content_version: int = 1
    review: ReviewAttributionOut | None = None


class DailyOut(BaseModel):
    assigned_for: date
    assigned_at: datetime
    completed_at: datetime | None = None
    learned: bool
    concept: ConceptOut
    # True when the followed-topic pool was empty and the catalog was widened,
    # so the client can explain why today's concept is off-topic.
    outside_followed_topics: bool = False


class DailyPersonalizationRequiredOut(BaseModel):
    """No assignment is created until the learner follows an active topic."""

    assigned_for: date
    reason: Literal["personalization_required"] = "personalization_required"
    detail: str = "Follow at least one topic to receive a daily concept."


class DailyExhaustedOut(BaseModel):
    assigned_for: date
    reason: Literal["catalog_exhausted"] = "catalog_exhausted"
    detail: str = "You have already been assigned every available concept."


class DailyUnavailableOut(BaseModel):
    """Typed 409 payload for a daily lesson that cannot be created yet."""

    assigned_for: date
    reason: Literal["personalization_required", "catalog_exhausted"]
    detail: str


class ReviewOut(DailyOut):
    review_id: uuid.UUID

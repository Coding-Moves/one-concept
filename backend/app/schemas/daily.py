import uuid
from datetime import date, datetime

from pydantic import BaseModel


class ConceptOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    summary: str
    example: str | None = None
    topic_slug: str
    topic_name: str


class DailyOut(BaseModel):
    assigned_for: date
    assigned_at: datetime
    completed_at: datetime | None = None
    learned: bool
    concept: ConceptOut
    # True when the followed-topic pool was empty and the catalog was widened,
    # so the client can explain why today's concept is off-topic.
    outside_followed_topics: bool = False


class DailyExhaustedOut(BaseModel):
    assigned_for: date
    reason: str = "catalog_exhausted"
    detail: str = "You have already been assigned every available concept."

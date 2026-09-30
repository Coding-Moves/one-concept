import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SubtopicCompletionOut(BaseModel):
    id: uuid.UUID
    topic_slug: str
    topic_name: str
    subtopic_slug: str
    subtopic_name: str
    completed_at: datetime


class SubtopicProgressOut(BaseModel):
    topic_slug: str
    topic_name: str
    subtopic_slug: str
    subtopic_name: str
    completed_concepts: int
    available_concepts: int
    completed: bool


class SubtopicProgressCollectionOut(BaseModel):
    items: list[SubtopicProgressOut]


class AcknowledgeSubtopicCompletionsIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)

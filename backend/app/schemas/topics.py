import uuid

from pydantic import BaseModel


class TopicOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None = None
    concept_count: int
    following: bool

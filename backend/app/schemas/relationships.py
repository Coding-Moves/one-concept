from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class RelationshipEntry(BaseModel):
    """A private list entry; it never reveals an account identifier or email."""

    id: UUID
    display_name: str
    public_path: str | None = None
    avatar_ref: str | None = None
    avatar_url: str | None = None


class RelationshipPage(BaseModel):
    items: list[RelationshipEntry]
    next_cursor: str | None = None


class RelationshipStatus(BaseModel):
    state: Literal['available', 'connected', 'self', 'unavailable']
    relationship_id: UUID | None = None

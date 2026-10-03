from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConnectionPreferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    accepting_requests: bool = False
    version: int = Field(ge=0)


class ConnectionEntry(BaseModel):
    id: UUID
    display_name: str
    public_path: str | None = None


class ConnectionPage(BaseModel):
    items: list[ConnectionEntry]
    next_cursor: UUID | None = None


class ConnectionStatus(BaseModel):
    state: Literal['available', 'unavailable', 'self', 'incoming', 'outgoing', 'accepted', 'cooldown']
    id: UUID | None = None
    retry_after: int | None = None


class ConnectionAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['accept', 'decline', 'cancel', 'remove', 'block']

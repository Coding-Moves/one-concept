from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.services.profile import normalize_display_name
from app.services.profile_avatar import PRESETS, normalize_bio

from app.schemas.daily import DailyOut, ReviewOut
from app.schemas.subtopics import SubtopicCompletionOut


class StreakOut(BaseModel):
    current: int
    longest: int
    total_learned: int
    total_reviews: int = 0


class SavedConceptOut(BaseModel):
    concept_slug: str
    title: str = ""
    topic_name: str = ""
    like_count: int = 0


class LearnedOut(BaseModel):
    concept_slug: str
    learned_on: date
    # What the history screen renders; the client no longer needs a local
    # catalog to give a learned lesson its name.
    title: str = ""
    topic_name: str = ""
    like_count: int = 0


class HistoryPageOut(BaseModel):
    items: list[LearnedOut]
    next_cursor: str | None = None


class SavedPageOut(BaseModel):
    items: list[SavedConceptOut]
    next_cursor: str | None = None


class StateOut(BaseModel):
    display_name: str | None = None
    bio: str | None = None
    avatar_ref: str | None = None
    avatar_url: str | None = None
    timezone: str
    today: date
    followed_topics: list[str]
    learned: list[LearnedOut]
    likes: list[str]
    bookmarks: list[str]
    saved: list[SavedConceptOut] = Field(default_factory=list)
    stats: StreakOut
    # Present for compact clients. Counts exclude the embedded recent window,
    # so optimistic/offline completions can still be added by the client.
    learned_before_window: dict[str, int] | None = None
    history_next_cursor: str | None = None
    saved_next_cursor: str | None = None
    assignment_slug: str | None = None
    # Today's concept, folded in so the app needs a single round trip at startup
    # (issue #102). `daily` is null when it cannot be created; the explicit
    # availability value distinguishes topic setup from a spent catalog.
    daily: DailyOut | None = None
    daily_availability: Literal[
        "available", "personalization_required", "catalog_exhausted", "review_available"
    ] = "available"
    review: ReviewOut | None = None


class TopicsIn(BaseModel):
    # Whole-list semantics: this replaces the followed set rather than adding to it.
    topics: list[str] = Field(default_factory=list, max_length=50)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=60)

    @field_validator("display_name")
    @classmethod
    def valid_display_name(cls, value: str | None) -> str | None:
        return normalize_display_name(value) if value is not None else None

    bio: str | None = Field(default=None, max_length=160)

    @field_validator("bio")
    @classmethod
    def valid_bio(cls, value: str | None) -> str | None:
        return normalize_bio(value)

    avatar_preset: str | None = None

    @field_validator("avatar_preset")
    @classmethod
    def valid_avatar_preset(cls, value: str | None) -> str | None:
        if value is not None and value not in PRESETS:
            raise ValueError("Unknown avatar preset")
        return value

    # IANA zone name; owns every day boundary for this user.
    timezone: str | None = Field(default=None, max_length=64)
    initialize_timezone: bool = False


class CompletedOut(BaseModel):
    completed: bool
    assigned_for: date
    stats: StreakOut
    subtopic_completion: SubtopicCompletionOut | None = None

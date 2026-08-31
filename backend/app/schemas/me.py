from datetime import date

from pydantic import BaseModel, Field


class StreakOut(BaseModel):
    current: int
    longest: int
    total_learned: int


class LearnedOut(BaseModel):
    concept_slug: str
    learned_on: date
    # What the history screen renders; the client no longer needs a local
    # catalog to give a learned lesson its name.
    title: str = ""
    topic_name: str = ""


class StateOut(BaseModel):
    display_name: str | None = None
    timezone: str
    today: date
    followed_topics: list[str]
    learned: list[LearnedOut]
    likes: list[str]
    bookmarks: list[str]
    stats: StreakOut
    assignment_slug: str | None = None


class TopicsIn(BaseModel):
    # Whole-list semantics: this replaces the followed set rather than adding to it.
    topics: list[str] = Field(default_factory=list, max_length=50)


class ProfileIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    # IANA zone name; owns every day boundary for this user.
    timezone: str | None = Field(default=None, max_length=64)


class CompletedOut(BaseModel):
    completed: bool
    assigned_for: date
    stats: StreakOut

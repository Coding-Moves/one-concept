from datetime import date

from pydantic import BaseModel, Field

from app.schemas.daily import DailyOut


class StreakOut(BaseModel):
    current: int
    longest: int
    total_learned: int


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
    # (issue #102). Null when the catalog is exhausted for this user. This GET
    # creates the day's assignment on first call, exactly like GET /v1/daily.
    daily: DailyOut | None = None


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

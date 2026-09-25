from datetime import date, datetime

from pydantic import BaseModel, Field


class AchievementOut(BaseModel):
    code: str
    metric: str
    threshold: int
    name: str
    description: str
    artwork_key: str
    earned_on: date | None
    source: str | None
    seen_at: datetime | None


class AchievementsOut(BaseModel):
    current_streak: int
    longest_streak: int
    items: list[AchievementOut]


class AcknowledgeIn(BaseModel):
    codes: list[str] = Field(min_length=1, max_length=100)

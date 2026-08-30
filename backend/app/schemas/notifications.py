import re

from pydantic import BaseModel, Field, field_validator

_HH_MM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class PushTokenIn(BaseModel):
    # ExponentPushToken[...] from expo-notifications; opaque to us.
    expo_push_token: str = Field(min_length=10, max_length=200)
    platform: str | None = Field(default=None, pattern="^(ios|android)$")


class NotificationPrefs(BaseModel):
    enabled: bool
    # Local wall-clock times in the user's profile timezone.
    reminder_times: list[str] = Field(min_length=1, max_length=3)

    @field_validator("reminder_times")
    @classmethod
    def _valid_times(cls, value: list[str]) -> list[str]:
        for t in value:
            if not _HH_MM.match(t):
                raise ValueError(f"invalid time {t!r}, expected HH:MM")
        return sorted(set(value))

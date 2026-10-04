from pydantic import BaseModel, ConfigDict, Field


class SharingIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool = False
    show_name: bool = False
    show_avatar: bool = False
    show_streak: bool = False
    show_learning: bool = False
    achievement_codes: list[str] = Field(default_factory=list, max_length=32)
    version: int = Field(ge=0)


class SharingOut(SharingIn):
    public_path: str | None = None


class PublicAchievement(BaseModel):
    name: str
    description: str


class PublicProfile(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None
    current_streak: int | None = None
    longest_streak: int | None = None
    concepts_learned: int | None = None
    achievements: list[PublicAchievement] = Field(default_factory=list)

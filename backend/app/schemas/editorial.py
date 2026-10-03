"""Strict account contracts; no request accepts a password or trusted identity."""

import re
import unicodedata
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Capability = Literal[
    "review", "approve", "publish", "request_generation", "manage_reviewers"
]
CAPABILITIES = [
    "review",
    "approve",
    "publish",
    "request_generation",
    "manage_reviewers",
]


def validate_registered_name(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise ValueError(
            "Name must not contain control or invisible formatting characters"
        )
    value = " ".join(value.split())
    if not 2 <= len(value) <= 80:
        raise ValueError("Name must contain 2 to 80 characters")
    return value


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VersionInput(StrictInput):
    expected_version: int = Field(ge=1, strict=True)


class ProfileInput(VersionInput):
    registered_name: str = Field(max_length=160)

    _name = field_validator("registered_name")(validate_registered_name)


class AccessInput(VersionInput):
    status: Literal["active", "revoked"]
    capabilities: list[Capability] = Field(max_length=5)


class InviteInput(StrictInput):
    email: str = Field(max_length=254)
    capabilities: list[Capability] = Field(
        default_factory=lambda: ["review"], max_length=5
    )

    @field_validator("email")
    @classmethod
    def email_address(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) or any(
            unicodedata.category(c).startswith("C") for c in value
        ):
            raise ValueError("Enter a valid email address")
        return value


class Member(BaseModel):
    user_id: UUID
    invited_email: str
    notification_timezone: str = "UTC"
    status: Literal["active", "revoked"]
    capabilities: list[Capability]
    requested_name: str | None
    approved_name: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class Me(BaseModel):
    member: Member
    onboarding_required: bool
    name_approval_pending: bool
    mfa_required: bool


class MemberPage(BaseModel):
    items: list[Member]
    next_cursor: UUID | None

"""Bounded editorial commands. Identity is never accepted from request bodies."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.editorial import StrictInput
from app.services.content_quality import QualityReview
from app.services.publication import LessonBody

RevisionStatus = Literal[
    "generating",
    "draft",
    "validation_failed",
    "pending_review",
    "changes_requested",
    "approved",
    "rejected",
    "published",
    "retired",
]


class Command(StrictInput):
    request_id: UUID
    note: str = Field(min_length=10, max_length=4000)


class VersionCommand(Command):
    expected_token: str = Field(pattern=r"^[a-f0-9]{64}$")


class RevisionAction(VersionCommand):
    action: Literal[
        "submit",
        "comment",
        "assign",
        "changes_requested",
        "rejected",
        "approved",
        "publish",
        "approve_and_publish",
        "retired",
    ]
    quality: QualityReview | None = None
    assignee_id: UUID | None = None
    review_due_at: datetime | None = None

    @model_validator(mode="after")
    def action_fields(self):
        if (self.action in ("approved", "approve_and_publish")) != (
            self.quality is not None
        ):
            raise ValueError(
                "Only approval actions require the complete quality checklist"
            )
        if self.action != "assign" and self.assignee_id is not None:
            raise ValueError("Only assignment accepts an assignee")
        if "review_due_at" in self.model_fields_set:
            if self.action != "assign":
                raise ValueError("Only assignment accepts a review deadline")
            if self.review_due_at is not None and self.review_due_at.tzinfo is None:
                raise ValueError("Review deadline requires a timezone")
        return self


class StageInput(VersionCommand):
    body: LessonBody


class ConceptAction(VersionCommand):
    action: Literal["attest", "retire"]
    quality: QualityReview | None = None

    @model_validator(mode="after")
    def action_fields(self):
        if (self.action == "attest") != (self.quality is not None):
            raise ValueError("Only attestation requires the complete quality checklist")
        return self


class GenerationInput(Command):
    topic_id: UUID
    count: int = Field(ge=1, le=10, strict=True)


GenerationJobStatus = Literal[
    "pending", "generating", "failed", "ready_for_review", "cancelled", "superseded"
]

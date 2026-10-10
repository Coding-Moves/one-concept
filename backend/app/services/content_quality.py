"""Structural checks and an auditable human gate for catalog publication.

Automated checks reject malformed learning material; a named reviewer remains
responsible for factual accuracy and suitability.
"""

import re
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.services.curriculum import StrictModel, normalized


def normalized_option(value: str) -> str:
    """Ignore casing and spacing without erasing meaningful math/code symbols."""
    return " ".join(re.findall(r"\w+|[^\w\s]", value.casefold()))


class Flashcard(StrictModel):
    front: str = Field(min_length=12, max_length=280)
    back: str = Field(min_length=12, max_length=500)

    @model_validator(mode="after")
    def must_add_recall_value(self):
        if normalized(self.front) == normalized(self.back):
            raise ValueError("Flashcard back must not repeat its front")
        return self


class MultipleChoiceQuestion(StrictModel):
    question: str = Field(min_length=12, max_length=360)
    options: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)

    @field_validator("options")
    @classmethod
    def options_are_distinct_and_useful(cls, values):
        if any(len(value.strip()) < 1 or len(value) > 240 for value in values):
            raise ValueError("Each MCQ option must be between 1 and 240 characters")
        if len({normalized_option(value) for value in values}) != len(values):
            raise ValueError("MCQ options must be distinct")
        return values


class LearningPackage(StrictModel):
    flashcard: Flashcard
    mcqs: list[MultipleChoiceQuestion] = Field(min_length=3, max_length=3)

    @field_validator("mcqs")
    @classmethod
    def questions_are_distinct(cls, values):
        if len({normalized(value.question) for value in values}) != len(values):
            raise ValueError("MCQ questions must be distinct")
        return values


class QualityReview(StrictModel):
    factual_accuracy: bool
    usefulness: bool
    clarity: bool
    topic_subtopic_accuracy: bool
    example_quality: bool
    flashcard_quality: bool
    mcq_quality: bool
    references_checked: bool
    sensitive_topic_handling: Literal["not_applicable", "reviewed"]

    @model_validator(mode="after")
    def every_required_human_check_is_complete(self):
        unchecked = [name for name, value in self.model_dump().items()
                     if isinstance(value, bool) and not value]
        if unchecked:
            raise ValueError("Required quality checks are incomplete: " + ", ".join(unchecked))
        return self

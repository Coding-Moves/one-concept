import pytest
from pydantic import ValidationError

from app.services.content_quality import LearningPackage, QualityReview


def package():
    return {"flashcard": {"front": "What is the key idea to remember here?", "back": "Use the key idea when the described situation applies."}, "mcqs": [
        {"question": "Which answer states the core idea?", "options": ["The core idea", "A distraction", "A contradiction", "A random fact"], "correct_index": 0},
        {"question": "When should the idea be used?", "options": ["When its context applies", "Never", "Only by accident", "For unrelated work"], "correct_index": 0},
        {"question": "What must a reviewer check?", "options": ["The stated source", "A password", "A color", "A device name"], "correct_index": 0},
    ]}


def review(**overrides):
    value = {"factual_accuracy": True, "usefulness": True, "clarity": True, "topic_subtopic_accuracy": True, "example_quality": True, "flashcard_quality": True, "mcq_quality": True, "references_checked": True, "sensitive_topic_handling": "not_applicable"}
    value.update(overrides)
    return value


def test_learning_package_requires_one_flashcard_and_exactly_three_distinct_mcqs():
    assert LearningPackage.model_validate(package()).mcqs[0].correct_index == 0
    data = package(); data["mcqs"][1]["question"] = data["mcqs"][0]["question"]
    with pytest.raises(ValidationError, match="distinct"):
        LearningPackage.model_validate(data)


def test_quality_review_cannot_claim_unchecked_criteria_are_approved():
    assert QualityReview.model_validate(review()).references_checked
    with pytest.raises(ValidationError, match="factual_accuracy"):
        QualityReview.model_validate(review(factual_accuracy=False))

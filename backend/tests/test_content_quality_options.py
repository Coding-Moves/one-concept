import pytest
from pydantic import ValidationError

from app.services.content_quality import MultipleChoiceQuestion


def test_symbolic_answers_keep_distinct_operators():
    question = MultipleChoiceQuestion.model_validate(
        {
            "question": "Which expression gives the requested derivative?",
            "options": ["x + y", "x - y", "x * y", "x / y"],
            "correct_index": 0,
        }
    )
    assert question.options[0] == "x + y"


def test_case_and_spacing_do_not_make_duplicate_answers_distinct():
    with pytest.raises(ValidationError, match="MCQ options must be distinct"):
        MultipleChoiceQuestion.model_validate(
            {
                "question": "Which expression gives the requested derivative?",
                "options": ["x+y", "X + Y", "x - y", "x / y"],
                "correct_index": 0,
            }
        )

"""Only sanitized editorial text may reach the provider prompt."""

import json
from types import SimpleNamespace

import pytest

from app.services import editorial_generation as jobs


@pytest.mark.parametrize(
    "secret", ['secret-with-"quotes"', r"secret-with-\slashes", "secret-with-\nnewline"]
)
def test_redaction_precedes_json_escaping_and_preserves_evidence(secret):
    source = {"title": "Lesson", "references": [{"title": "Reference " + secret}]}
    job = {"source_body": source, "feedback": "Please check " + secret}
    settings = SimpleNamespace(model_dump=lambda: {"supabase_jwt_secret": secret})
    context = jobs.revision_context(job, settings)
    payload = json.loads(context.split("\n", 1)[1])
    assert payload["reviewer_feedback"] == "Please check [redacted]"
    assert payload["base_revision"]["references"][0]["title"] == "Reference [redacted]"
    assert job["feedback"] == "Please check " + secret
    assert source["references"][0]["title"] == "Reference " + secret


async def test_all_prompt_fields_redacted_but_transport_auth_preserved(monkeypatch):
    from unittest.mock import AsyncMock

    secret = 'configured-"secret"'
    settings = SimpleNamespace(
        editorial_enabled=True,
        generation_enabled=True,
        gemini_api_key=secret,
        gemini_model="fixture",
        model_dump=lambda: {"gemini_api_key": secret},
    )
    job = {
        "source_body": {"title": "Title " + secret},
        "topic": "Topic " + secret,
        "subtopic": "Subtopic " + secret,
        "feedback": "Feedback " + secret,
    }
    monkeypatch.setattr(jobs, "claim", AsyncMock(return_value=(job, "generating")))
    generator = AsyncMock(return_value=object())
    monkeypatch.setattr(jobs, "generate_concept", generator)
    finish = AsyncMock(return_value="ready_for_review")
    monkeypatch.setattr(jobs, "finish", finish)
    db = object()
    assert await jobs.run_one(db, settings) == "ready_for_review"
    kwargs = generator.await_args.kwargs
    assert kwargs["title"] == "Title [redacted]"
    assert kwargs["topic_name"] == "Topic [redacted]"
    assert kwargs["subtopic_name"] == "Subtopic [redacted]"
    assert (
        json.loads(kwargs["angle"].split("\n", 1)[1])["reviewer_feedback"]
        == "Feedback [redacted]"
    )
    assert kwargs["api_key"] == secret  # Used only as the provider credential.
    assert finish.await_args.args[2] is job
    assert job["source_body"]["title"] == "Title " + secret

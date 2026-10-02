"""Real authenticated commands and durable jobs with no external provider calls."""

import asyncio
import json
from uuid import UUID, uuid4
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import editorial_generation as jobs
from app.services.generation import GeneratedConcept, GenerationError, RateLimitedError
from app.services.publication import LessonBody, stage_revision
from tests import test_editorial_content_api as content

editorial = content.editorial
api = content.api
draft = content.draft
NOTE = content.NOTE
ROOT = content.ROOT


@pytest.fixture
async def queued(api, session, draft, monkeypatch):
    api.settings.generation_enabled = True
    api.settings.gemini_api_key = "test-provider-key"
    rid = await content.rid_for(session, draft[1])
    await session.commit()
    await content.act(api, rid, "submit")
    await content.act(
        api,
        rid,
        "changes_requested",
        note="Explain the failure case with a more concrete example.",
    )
    source = await content.detail(api, rid)
    command = {
        "request_id": str(uuid4()),
        "expected_token": source["token"],
        "note": NOTE,
    }
    response = await api.client.post(
        f"{ROOT}/revisions/{rid}/generation-requests",
        headers=api.headers(),
        json=command,
    )
    assert response.status_code == 202, response.text
    generator = AsyncMock(
        return_value=GeneratedConcept(
            summary="Revised useful explanation with a precise learning objective. "
            * 3,
            example="A revised concrete example that demonstrates the failure case clearly.",
            model="fixture",
        )
    )
    monkeypatch.setattr(jobs, "generate_concept", generator)
    job = response.json()
    yield job, rid, source, command, generator
    await session.rollback()
    # Immutable evidence is retained, but stop unprocessed fixture work from
    # affecting subsequent batch tests or the shared concurrency limit.
    await session.execute(
        text("""update editorial_generation_jobs set status='cancelled',claim_token=null,claimed_at=null
      where id=:id and status in ('pending','generating')"""),
        {"id": UUID(job["id"])},
    )
    await session.commit()


async def get(api, job):
    response = await api.client.get(
        f"{ROOT}/generation-jobs/{job['id']}", headers=api.headers()
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


async def test_request_replay_and_new_private_validated_revision(api, session, queued):
    job, rid, source, command, generator = queued
    again = await api.client.post(
        f"{ROOT}/revisions/{rid}/generation-requests",
        headers=api.headers(),
        json=command,
    )
    assert again.json() == job
    duplicate = await api.client.post(
        f"{ROOT}/revisions/{rid}/generation-requests",
        headers=api.headers(),
        json=command | {"request_id": str(uuid4())},
    )
    assert duplicate.status_code == 409
    assert generator.await_count == 0
    before = await session.scalar(
        text("select sum(calls_used) from generation_daily_usage")
    )
    assert await jobs.run_one(session, api.settings) == "ready_for_review"
    assert not session.in_transaction()
    finished = await get(api, job)
    assert finished["result_revision_id"] != str(rid)
    assert finished["attempts"] == 1 and "claim_token" not in finished
    result = await content.detail(api, finished["result_revision_id"])
    assert result["status"] == "draft" and result["validation"]["valid"]
    assert result["body"]["summary"] != source["body"]["summary"]
    assert (await content.detail(api, rid))["body"] == source["body"]
    assert (await content.act(api, finished["result_revision_id"], "publish"))[
        0
    ].status_code == 409
    assert (
        await session.scalar(
            text("select content_version from concepts where id=:id"),
            {"id": UUID(job["concept_id"])},
        )
        == 0
    )
    assert (
        await session.scalar(text("select sum(calls_used) from generation_daily_usage"))
        == before + 1
    )
    prompt = generator.call_args.kwargs["angle"]
    assert "failure case" in prompt and source["body"]["summary"] in prompt
    assert "test-provider-key" not in prompt
    with pytest.raises(DBAPIError, match="immutable"):
        await session.execute(
            text("update concept_revisions set body='{}' where id=:id"),
            {"id": UUID(finished["result_revision_id"])},
        )
    await session.rollback()


@pytest.mark.parametrize(
    "mode", ["disabled", "editorial_disabled", "missing_key", "quota"]
)
async def test_off_or_quota_never_spends_or_claims(api, session, queued, mode):
    job, _, _, _, generator = queued
    config = api.settings.model_copy()
    if mode == "disabled":
        config.generation_enabled = False
    if mode == "editorial_disabled":
        config.editorial_enabled = False
    if mode == "missing_key":
        config.gemini_api_key = ""
    if mode == "quota":
        config.generation_daily_call_cap = 0
    before = await session.scalar(
        text("select sum(calls_used) from generation_daily_usage")
    )
    await session.commit()
    assert await jobs.run_one(session, config) in (
        "disabled",
        "key_missing",
        "quota_exhausted",
    )
    assert (await get(api, job))["attempts"] == 0
    assert (
        await session.scalar(text("select sum(calls_used) from generation_daily_usage"))
        == before
    )
    generator.assert_not_awaited()


@pytest.mark.parametrize(
    "failure,code",
    [
        (GenerationError("secret-provider-diagnostic"), "provider_error"),
        (RateLimitedError(), "rate_limited"),
    ],
)
async def test_bounded_retries_and_safe_diagnostics(
    api, session, queued, failure, code
):
    job, _, _, _, generator = queued
    generator.side_effect = failure
    for attempt in range(1, 4):
        assert await jobs.run_one(session, api.settings) == (
            "failed" if attempt == 3 else "pending"
        )
        visible = await get(api, job)
        assert visible["attempts"] == attempt and visible["failure_code"] == code
        assert "secret-provider" not in json.dumps(visible)
        assert (
            await jobs.run_one(session, api.settings) == "empty"
        )  # retry delay, no loop
        await session.execute(
            text(
                "update editorial_generation_jobs set available_at=now() where id=:id"
            ),
            {"id": UUID(job["id"])},
        )
        await session.commit()
    assert await jobs.run_one(session, api.settings) == "empty"
    assert generator.await_count == 3


@pytest.mark.parametrize("change", ["cancel", "manual_edit", "revoke", "retire"])
async def test_inflight_results_do_not_overwrite_newer_work(
    api, session, queued, sessionmaker_for_test, change
):
    job, rid, source, _, generator = queued

    async def during_provider(**kwargs):
        assert not session.in_transaction()
        async with sessionmaker_for_test() as other:
            live = await jobs.get_job(other, UUID(job["id"]))
            assert live["status"] == "generating" and live["attempts"] == 1
            await other.commit()
            if change == "cancel":
                current = await get(api, job)
                command = {
                    "request_id": str(uuid4()),
                    "expected_token": current["token"],
                    "note": NOTE,
                }
                url = f"{ROOT}/generation-jobs/{job['id']}/cancel"
                cancelled = await api.client.post(
                    url, headers=api.headers(), json=command
                )
                assert cancelled.status_code == 200, cancelled.text
                assert (
                    await api.client.post(url, headers=api.headers(), json=command)
                ).json() == cancelled.json()
            elif change == "manual_edit":
                slug = await other.scalar(
                    text("select slug from concepts where id=:id"),
                    {"id": UUID(job["concept_id"])},
                )
                await stage_revision(
                    other, slug, LessonBody.model_validate(source["body"])
                )
            elif change == "revoke":
                await other.execute(
                    text(
                        "update editorial_memberships set capabilities=array['review'] where user_id=:id"
                    ),
                    {"id": api.owner.id},
                )
            else:
                await other.execute(
                    text("update concepts set status='archived' where id=:id"),
                    {"id": UUID(job["concept_id"])},
                )
            await other.commit()
        return GeneratedConcept(
            summary="A delayed revised explanation that must not replace newer work. "
            * 3,
            example="A delayed example that should never be saved as a new revision.",
            model="fixture",
        )

    generator.side_effect = during_provider
    assert await jobs.run_one(session, api.settings) in ("superseded", "cancelled")
    assert (await get(api, job))["result_revision_id"] is None
    assert (await content.detail(api, rid))["body"] == source["body"]
    assert await session.scalar(
        text("select count(*) from concept_revisions where concept_id=:id"),
        {"id": UUID(job["concept_id"])},
    ) == (2 if change == "manual_edit" else 1)


async def test_stale_claim_recovery_fences_late_worker(api, session, queued):
    job, _, _, _, generator = queued
    first, _ = await jobs.claim(session, api.settings)
    await session.execute(
        text(
            "update editorial_generation_jobs set claimed_at=now()-interval '31 minutes' where id=:id"
        ),
        {"id": UUID(job["id"])},
    )
    await session.commit()
    second, _ = await jobs.claim(session, api.settings)
    assert first["claim_token"] != second["claim_token"] and second["attempts"] == 2
    assert (
        await jobs.finish(session, api.settings, first, result=generator.return_value)
        == "superseded"
    )
    assert (await get(api, job))["status"] == "generating"
    assert (
        await jobs.finish(session, api.settings, second, result=generator.return_value)
        == "ready_for_review"
    )


async def test_invalid_package_stays_private_and_manual_staging_remains(
    api, session, queued
):
    job, _, source, _, generator = queued
    generator.return_value.summary = "Too short"
    assert await jobs.run_one(session, api.settings) == "pending"
    assert (await get(api, job))["failure_code"] == "invalid_output"
    cid = UUID(job["concept_id"])
    concept = (
        await api.client.get(f"{ROOT}/concepts/{cid}", headers=api.headers())
    ).json()
    response = await api.client.post(
        f"{ROOT}/concepts/{cid}/revisions",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": concept["token"],
            "note": NOTE,
            "body": source["body"],
        },
    )
    assert response.status_code == 201, response.text
    await session.execute(
        text("update editorial_generation_jobs set available_at=now() where id=:id"),
        {"id": UUID(job["id"])},
    )
    await session.commit()
    assert await jobs.run_one(session, api.settings) == "superseded"
    assert generator.await_count == 1


async def test_private_jobs_and_aal2_required(api, session, queued):
    job, rid, _, command, _ = queued
    paths = [
        f"{ROOT}/generation-jobs",
        f"{ROOT}/generation-jobs/{job['id']}",
        f"{ROOT}/generation-supply/{job['topic_id']}",
    ]
    for path in paths:
        assert (await api.client.get(path)).status_code == 401
        assert (
            await api.client.get(path, headers=api.headers(aal="aal1"))
        ).status_code == 403
    assert (
        await api.client.post(
            f"{ROOT}/revisions/{rid}/generation-requests",
            headers=api.headers(aal="aal1"),
            json=command,
        )
    ).status_code == 403
    rows = (
        await api.client.get(
            f"{ROOT}/generation-jobs",
            headers=api.headers(),
            params={"topic_id": job["topic_id"]},
        )
    ).json()["items"]
    assert [r["id"] for r in rows] == [job["id"]]
    await session.execute(
        text("grant select on editorial_generation_jobs to authenticated")
    )
    await session.execute(text("set local role authenticated"))
    assert (
        await session.execute(text("select * from editorial_generation_jobs"))
    ).all() == []
    await session.rollback()


async def test_job_claim_concurrency_and_pool_share_limit(
    api, session, queued, monkeypatch, sessionmaker_for_test
):
    from app.config import get_settings
    from app.services import pool
    from app.services.generation_budget import GenerationBusy

    job, _, _, _, generator = queued
    monkeypatch.setattr(get_settings(), "generation_max_concurrent", 1)

    async def concurrent_claim():
        async with sessionmaker_for_test() as db:
            return await jobs.claim(db, api.settings)

    results = await asyncio.gather(*(concurrent_claim() for _ in range(4)))
    assert sum(row is not None for row, _ in results) == 1
    await session.execute(
        text("""insert into concept_backlog(topic_id,subtopic_id,slug,title)
      select topic_id,subtopic_id,:slug,'Capacity fixture' from concepts where id=:id"""),
        {"id": UUID(job["concept_id"]), "slug": "capacity-" + uuid4().hex},
    )
    await session.commit()
    with pytest.raises(GenerationBusy):
        await pool.generate_one(
            session, "fixture", "fixture", UUID(job["topic_id"]), call_cap=20
        )
    assert (await get(api, job))["attempts"] == 1
    generator.assert_not_awaited()


async def test_cancelled_claim_does_not_spend_another_attempt(api, session, queued):
    job, _, _, _, generator = queued
    response = await api.client.post(
        f"{ROOT}/generation-jobs/{job['id']}/cancel",
        headers=api.headers(),
        json={"request_id": str(uuid4()), "expected_token": job["token"], "note": NOTE},
    )
    assert response.status_code == 200
    assert await jobs.run_one(session, api.settings) == "empty"
    generator.assert_not_awaited()
    assert (await get(api, job))["attempts"] == 0


async def test_stale_job_token_rejects_cancel(api, session, queued):
    job, _, _, _, _ = queued
    await jobs.claim(session, api.settings)
    response = await api.client.post(
        f"{ROOT}/generation-jobs/{job['id']}/cancel",
        headers=api.headers(),
        json={"request_id": str(uuid4()), "expected_token": job["token"], "note": NOTE},
    )
    assert response.status_code == 409
    assert (await get(api, job))["status"] == "generating"


async def test_abandoned_jobs_stop_after_three_claims(api, session, queued):
    job, _, _, _, generator = queued
    for _ in range(3):
        claimed, state = await jobs.claim(session, api.settings)
        assert claimed and state == "generating"
        await session.execute(
            text(
                "update editorial_generation_jobs set claimed_at=now()-interval '31 minutes' where id=:id"
            ),
            {"id": UUID(job["id"])},
        )
        await session.commit()
    assert await jobs.run_one(session, api.settings) == "empty"
    final = await get(api, job)
    assert (
        final["status"] == "failed"
        and final["attempts"] == 3
        and final["failure_code"] == "stale_claim"
    )
    generator.assert_not_awaited()


async def test_revoked_request_cannot_replay_or_run(api, session, queued):
    job, rid, _, command, generator = queued
    await session.execute(
        text(
            "update editorial_memberships set capabilities=array['review'] where user_id=:id"
        ),
        {"id": api.owner.id},
    )
    await session.commit()
    response = await api.client.post(
        f"{ROOT}/revisions/{rid}/generation-requests",
        headers=api.headers(),
        json=command,
    )
    assert response.status_code == 403
    assert await jobs.run_one(session, api.settings) == "cancelled"
    assert (await get(api, job))["failure_code"] == "requester_inactive"
    generator.assert_not_awaited()


async def test_revision_context_redacts_server_secrets(api, queued):
    _, _, source, _, _ = queued
    context = jobs.revision_context(
        {
            "source_body": source["body"],
            "feedback": "Please review " + api.settings.gemini_api_key,
        },
        api.settings,
    )
    assert api.settings.gemini_api_key not in context and "[redacted]" in context


async def test_batch_produces_private_draft_without_publication(api, session, queued):
    job, _, _, _, _ = queued
    api.settings.generation_pace_seconds = 0
    outcome = await jobs.run_batch(session, api.settings)
    assert outcome == {"ready_for_review": 1, "stop_reason": "empty"}
    assert (await get(api, job))["result_revision_id"]
    assert (
        await session.scalar(
            text("select count(*) from editorial_publications where concept_id=:id"),
            {"id": UUID(job["concept_id"])},
        )
        == 0
    )


async def test_health_report_exposes_only_aggregate_job_states(api, session, queued):
    from app.services.content_health import health_report

    job, _, _, _, generator = queued
    generator.side_effect = GenerationError("private provider diagnostics")
    await jobs.run_one(session, api.settings)
    report = await health_report(session)
    assert report["revision_jobs"]["pending"] >= 1
    assert "private provider diagnostics" not in json.dumps(report, default=str)
    assert job["id"] not in json.dumps(report, default=str)


async def test_cancelled_inflight_call_keeps_shared_provider_slot(
    api, session, queued, monkeypatch, sessionmaker_for_test
):
    from app.config import get_settings
    from app.services import pool
    from app.services.generation_budget import GenerationBusy

    job, _, _, _, generator = queued
    monkeypatch.setattr(get_settings(), "generation_max_concurrent", 1)
    entered, release = asyncio.Event(), asyncio.Event()
    output = generator.return_value

    async def delayed(**kwargs):
        entered.set()
        await release.wait()
        return output

    generator.side_effect = delayed
    await session.execute(
        text("""insert into concept_backlog(topic_id,subtopic_id,slug,title)
      select topic_id,subtopic_id,:slug,'Queued while cancelling' from concepts where id=:id"""),
        {"id": UUID(job["concept_id"]), "slug": "cancel-slot-" + uuid4().hex},
    )
    await session.commit()

    async def worker():
        async with sessionmaker_for_test() as db:
            return await jobs.run_one(db, api.settings)

    running = asyncio.create_task(worker())
    await asyncio.wait_for(entered.wait(), 5)
    try:
        current = await get(api, job)
        response = await api.client.post(
            f"{ROOT}/generation-jobs/{job['id']}/cancel",
            headers=api.headers(),
            json={
                "request_id": str(uuid4()),
                "expected_token": current["token"],
                "note": NOTE,
            },
        )
        assert response.status_code == 200 and response.json()["status"] == "cancelled"
        with pytest.raises(GenerationBusy):
            await pool.generate_one(
                session, "fixture", "fixture", UUID(job["topic_id"]), call_cap=20
            )
    finally:
        release.set()
        await running
    assert (await get(api, job))["result_revision_id"] is None
    assert await pool.generate_one(
        session, "fixture", "fixture", UUID(job["topic_id"]), call_cap=20
    )


async def test_abandoned_cancelled_lease_expires_without_retry(api, session, queued):
    job, _, _, _, generator = queued
    claimed, state = await jobs.claim(session, api.settings)
    assert state == "generating"
    current = await get(api, job)
    response = await api.client.post(
        f"{ROOT}/generation-jobs/{job['id']}/cancel",
        headers=api.headers(),
        json={
            "request_id": str(uuid4()),
            "expected_token": current["token"],
            "note": NOTE,
        },
    )
    assert response.status_code == 200
    assert (
        await session.scalar(
            text("select claim_token from editorial_generation_jobs where id=:id"),
            {"id": UUID(job["id"])},
        )
        == claimed["claim_token"]
    )
    await session.execute(
        text(
            "update editorial_generation_jobs set claimed_at=now()-interval '31 minutes' where id=:id"
        ),
        {"id": UUID(job["id"])},
    )
    await session.commit()
    assert await jobs.run_one(session, api.settings) == "empty"
    current = await jobs.get_job(session, UUID(job["id"]))
    assert current["status"] == "cancelled" and current["attempts"] == 1
    assert current["claim_token"] is None and current["claimed_at"] is None
    assert (
        await jobs.finish(session, api.settings, claimed, result=generator.return_value)
        == "superseded"
    )
    assert (await get(api, job))["result_revision_id"] is None
    generator.assert_not_awaited()

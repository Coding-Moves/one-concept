import asyncio
import uuid
from unittest.mock import AsyncMock

from app.config import get_settings
from app.services import pool
from app.services.content_health import health_report, observe_conditions
from app.services.generation import GenerationError
from app.services.publication import retry_failed
from sqlalchemy import text


async def test_report_redacts_raw_errors_and_counts_exhausted_attempts(
    session, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "generation_enabled", False)
    slug = "health-" + uuid.uuid4().hex
    tid = await session.scalar(
        text(
            "insert into public.topics(slug,name) values (:s,'Health fixture') returning id"
        ),
        {"s": slug},
    )
    await session.execute(
        text("""insert into public.concept_backlog(topic_id,slug,title,status,attempts,last_error)
      values (:t,:s,'Fixture','failed',3,'invalid JSON secret-token=do-not-display')"""),
        {"t": tid, "s": slug},
    )
    report = await health_report(session)
    assert "secret-token" not in str(report)
    assert str(tid) not in str(report)
    assert "generation_disabled" in report["conditions"]
    assert f"{slug}:failed_generation" in report["conditions"]
    topic = next(t for t in report["topics"] if t["slug"] == slug)
    assert topic["pending"] == 0 and topic["failed"] == 1
    await session.rollback()


async def test_condition_transitions_are_deduplicated_and_report_recovery(
    session, sessionmaker_for_test
):
    await session.execute(text("delete from public.content_conditions"))
    await session.commit()

    async def observe():
        async with sessionmaker_for_test() as other:
            changes = await observe_conditions(other, ["fixture:low_reserve"])
            await other.commit()
            return changes

    batches = await asyncio.gather(*(observe() for _ in range(5)))
    assert sum(len(b) for b in batches) == 1
    assert await observe_conditions(session, []) == [
        {"condition": "fixture:low_reserve", "state": "recovered"}
    ]
    await session.commit()
    assert await observe_conditions(session, []) == []
    await session.rollback()


async def test_failed_retry_preserves_attempts_and_grants_only_one_more_call(
    session, empty_generation_budget, monkeypatch
):
    slug = "retry-" + uuid.uuid4().hex
    tid = await session.scalar(
        text(
            "insert into public.topics(slug,name) values (:s,'Retry fixture') returning id"
        ),
        {"s": slug},
    )
    await session.execute(
        text("""insert into public.concept_backlog(topic_id,slug,title,status,attempts)
      values (:t,:s,'Fixture','failed',3)"""),
        {"t": tid, "s": slug},
    )
    await retry_failed(
        session,
        slug,
        "Maintainer",
        "Corrected the prompt and reviewed the provider failure.",
    )
    await session.commit()
    generate = AsyncMock(side_effect=GenerationError("bad response"))
    monkeypatch.setattr(pool, "generate_concept", generate)
    assert await pool.generate_one(session, "k", "m", tid, call_cap=10) is None
    assert await pool.generate_one(session, "k", "m", tid, call_cap=10) is None
    assert generate.await_count == 1
    row = (
        await session.execute(
            text("select status,attempts from public.concept_backlog where slug=:s"),
            {"s": slug},
        )
    ).one()
    assert tuple(row) == ("failed", 4)
    await session.execute(
        text("update public.topics set is_active=false where id=:t"), {"t": tid}
    )
    await session.commit()

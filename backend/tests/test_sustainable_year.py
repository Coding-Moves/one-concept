"""A real PostgreSQL simulation of continued learning beyond the original catalog."""

import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock

from sqlalchemy import text

from app.services import pool, selection
from app.services.curriculum import PlannedLesson, import_lessons
from app.services.generation import GeneratedConcept
from app.services.interactions import complete_today, set_followed_topics
from app.services.publication import publish_revision
from app.services.reviews import complete_review
from app.services.selection import get_or_create_daily
from app.services.streaks import compute_streaks
from app.services.supply import signal_reader, target_for


async def test_three_readers_learn_for_a_year_through_refills_and_outages(
    session, empty_generation_budget, monkeypatch
):
    prefix = "year-" + uuid.uuid4().hex
    # Other regression modules populate the shared test database with thousands
    # of collection rows. Scope only the simulation's catalog, retaining the
    # real eligibility/rotation SQL and the existing five subject records.
    monkeypatch.setattr(
        selection,
        "_CANDIDATE",
        text(
            str(selection._CANDIDATE).replace(
                "where c.status = 'published'",
                "where c.status = 'published' and starts_with(c.slug,:fixture_prefix)",
            )
        ).bindparams(fixture_prefix=prefix),
    )
    topics = (
        await session.execute(
            text(
                "select id,slug from public.topics where is_active order by sort_order limit 5"
            )
        )
    ).all()
    assert len(topics) == 5
    users = [uuid.uuid4() for _ in range(3)]
    for uid in users:
        await session.execute(
            text("insert into auth.users(id,email) values (:u,:e)"),
            {"u": uid, "e": f"{uid}@example.invalid"},
        )
    # Five topics, 25 new fixture lessons each. Existing seed lessons stay intact.
    for topic in topics:
        await session.execute(
            text("""insert into public.concepts(topic_id,slug,title,summary)
          select :t,:prefix||'-'||n,'Fixture '||n,'Fixture content'
          from generate_series(1,25) n"""),
            {"t": topic.id, "prefix": prefix + "-" + topic.slug},
        )
    await session.commit()
    await set_followed_topics(session, users[0], [t.slug for t in topics])
    await set_followed_topics(session, users[1], [topics[0].slug])
    await set_followed_topics(session, users[2], [topics[1].slug, topics[2].slug])
    generate = AsyncMock(
        return_value=GeneratedConcept(
            summary="A complete, useful explanation of this simulated learning objective. "
            * 3,
            example="A concrete example demonstrates the simulated lesson to its reader.",
            model="fixture",
        )
    )
    monkeypatch.setattr(pool, "generate_concept", generate)
    start = date(2024, 1, 1)
    seen = {uid: set() for uid in users}
    review_days = 0
    try:
        for offset in range(365):
            day = start + timedelta(days=offset)
            # A long simulated outage, plus delayed weekly publication. New
            # titles are imported in batches after the original queue was used.
            if offset % 7 == 0 and not 140 <= offset <= 210:
                topic = topics[(offset // 7) % 5]
                slug = f"{prefix}-new-{offset}"
                lesson = PlannedLesson(
                    slug=slug,
                    topic_slug=topic.slug,
                    title=f"Simulation objective {offset}",
                    curriculum={
                        "objective": f"Explain the distinct simulated behaviour numbered {offset}",
                        "difficulty": 1,
                        "references": [
                            {
                                "title": "Fixture source",
                                "url": "https://docs.python.org/3/",
                            }
                        ],
                    },
                )
                await import_lessons(session, [lesson])
                # Exercise a bounded supply claim, restricting only the fixture's
                # queue identity so real seeded pending titles remain untouched.
                await session.commit()
                with monkeypatch.context() as patch:
                    patch.setattr(
                        pool,
                        "_CLAIM",
                        text(
                            str(pool._CLAIM).replace(
                                "where b2.status = 'pending'",
                                "where b2.status = 'pending' and b2.slug=:only_slug",
                            )
                        ).bindparams(only_slug=slug),
                    )
                    inventory = await session.scalar(
                        text(
                            "select count(*) from public.concepts where topic_id=:t and status in ('published','draft')"
                        ),
                        {"t": topic.id},
                    )
                    cid = await pool.generate_one(
                        session,
                        "fixture",
                        "fixture",
                        topic.id,
                        call_cap=60,
                        supply_target=inventory + 1,
                    )
                rid = await session.scalar(
                    text("select id from public.concept_revisions where concept_id=:c"),
                    {"c": cid},
                )
                await publish_revision(
                    session,
                    rid,
                    "Fixture reviewer",
                    "Verified simulated lesson and source for the yearly regression.",
                )
                await session.commit()
            for uid in users:
                activity = await get_or_create_daily(
                    session, uid, today=day, allow_review=True
                )
                assert activity.status in ("ok", "review"), (
                    f"No useful activity on day {offset}"
                )
                if activity.status == "ok":
                    assert activity.concept.id not in seen[uid]
                    seen[uid].add(activity.concept.id)
                    await complete_today(session, uid, day)
                else:
                    review_days += 1
                    await complete_review(session, uid, activity.review_id, today=day)
                if offset % 30 == 0:
                    await signal_reader(session, uid, topics[0].id)
                    before = await target_for(session, topics[0].id)
                    await signal_reader(session, uid, topics[0].id)
                    assert await target_for(session, topics[0].id) == before
        for uid in users:
            stats = await compute_streaks(session, uid, start + timedelta(days=364))
            assert stats.current == stats.longest == 365
            assert stats.total_learned == len(seen[uid]) > 125
            assert stats.total_learned + stats.total_reviews == 365
        assert review_days > 0
        assert generate.await_count <= 60
        used = await session.scalar(
            text("select sum(calls_used) from public.generation_daily_usage")
        )
        assert used == generate.await_count
    finally:
        await session.rollback()
        # The shared suite keeps its original seed inventory and users.
        await session.execute(
            text("delete from auth.users where id=any(:ids)"), {"ids": users}
        )
        await session.execute(
            text(
                "delete from public.concept_revisions where concept_id in (select id from public.concepts where slug like :p)"
            ),
            {"p": prefix + "%"},
        )
        await session.execute(
            text("delete from public.concept_backlog where slug like :p"),
            {"p": prefix + "%"},
        )
        await session.execute(
            text("delete from public.concepts where slug like :p"), {"p": prefix + "%"}
        )
        await session.execute(text("delete from public.content_supply_targets"))
        await session.commit()

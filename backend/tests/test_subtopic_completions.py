"""Subtopic boundaries are calculated from real PostgreSQL learning records."""

import asyncio
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.interactions import complete_today
from app.services.subtopic_progress import progress, record_completion

DAY = date(2026, 2, 1)


async def _probability_catalog(session):
    rows = (await session.execute(text("""
        select c.id,c.topic_id,c.subtopic_id
          from public.concepts c
          join public.subtopics s on s.id=c.subtopic_id
         where s.slug='probability' and c.status='published'
         order by c.id
    """))).all()
    assert len(rows) >= 3, "the seeded probability subtopic is the exact-boundary fixture"
    return rows


async def _assign_and_complete(session, user, concept_id, day):
    await session.execute(text("""
        insert into public.daily_assignments(user_id,concept_id,assigned_for)
        values (:uid,:concept_id,:day)
    """), {"uid": user, "concept_id": concept_id, "day": day})
    return await complete_today(session, user, day)


async def test_completion_emits_once_at_the_exact_published_boundary(session, user):
    catalog = await _probability_catalog(session)
    for offset, concept in enumerate(catalog[:-1]):
        result = await _assign_and_complete(session, user, concept.id, DAY + timedelta(days=offset))
        assert result.subtopic_completion is None

    final = await _assign_and_complete(session, user, catalog[-1].id, DAY + timedelta(days=len(catalog) - 1))
    assert final.subtopic_completion is not None
    assert final.subtopic_completion.subtopic_slug == "probability"

    # Replaying the daily request is safe and never issues a second event.
    replay = await complete_today(session, user, DAY + timedelta(days=len(catalog) - 1))
    assert replay.subtopic_completion is None
    assert await session.scalar(text("""
        select count(*) from public.user_subtopic_completions
         where user_id=:uid and subtopic_id=:sid
    """), {"uid": user, "sid": catalog[0].subtopic_id}) == 1

    items = await progress(session, user)
    item = next(item for item in items if item.subtopic_slug == "probability")
    assert (item.completed_concepts, item.available_concepts, item.completed) == (len(catalog), len(catalog), True)


async def test_new_published_concept_reopens_without_repeating_old_event(session, user):
    catalog = await _probability_catalog(session)
    for offset, concept in enumerate(catalog):
        await _assign_and_complete(session, user, concept.id, DAY + timedelta(days=offset))

    extra = await session.execute(text("""
        insert into public.concepts(topic_id,subtopic_id,slug,title,summary,status)
        values (:topic_id,:subtopic_id,'subtopic-completion-fixture','Fixture lesson','Fixture summary','published')
        returning id
    """), {"topic_id": catalog[0].topic_id, "subtopic_id": catalog[0].subtopic_id})
    extra_id = extra.scalar_one()
    await session.commit()

    item = next(item for item in await progress(session, user) if item.subtopic_slug == "probability")
    assert (item.completed_concepts, item.available_concepts, item.completed) == (len(catalog), len(catalog) + 1, False)

    result = await _assign_and_complete(session, user, extra_id, DAY + timedelta(days=len(catalog)))
    assert result.subtopic_completion is not None
    assert await session.scalar(text("""
        select count(*) from public.user_subtopic_completions
         where user_id=:uid and subtopic_id=:sid
    """), {"uid": user, "sid": catalog[0].subtopic_id}) == 2
    # The shared disposable schema intentionally persists fixture catalog
    # rows between tests. Retire this temporary lesson so unrelated API tests
    # retain the reviewed five-subject seed inventory.
    await session.execute(text("update public.concepts set status='draft' where id=:id"), {"id": extra_id})
    await session.commit()


async def test_concurrent_devices_create_one_catalog_event(session, sessionmaker_for_test, user):
    catalog = await _probability_catalog(session)
    await session.execute(text("""
        insert into public.user_concept_completions(user_id,concept_id,completed_at)
        select :uid,unnest(cast(:concept_ids as uuid[])),now()
    """), {"uid": user, "concept_ids": [concept.id for concept in catalog]})
    await session.commit()

    async def complete_on_device():
        async with sessionmaker_for_test() as other:
            await other.execute(text("select id from public.profiles where id=:uid for update"), {"uid": user})
            event = await record_completion(other, user, catalog[0].id)
            await other.commit()
            return event

    first, second = await asyncio.gather(complete_on_device(), complete_on_device())
    assert sum(event is not None for event in (first, second)) == 1
    assert await session.scalar(text("""
        select count(*) from public.user_subtopic_completions
         where user_id=:uid and subtopic_id=:sid
    """), {"uid": user, "sid": catalog[0].subtopic_id}) == 1


async def test_historical_completion_backfill_marks_events_seen(session, user):
    catalog = await _probability_catalog(session)
    await session.execute(text("""
        insert into public.user_concept_completions(user_id,concept_id,completed_at)
        select :uid,unnest(cast(:concept_ids as uuid[])),now()
    """), {"uid": user, "concept_ids": [concept.id for concept in catalog]})
    await session.commit()

    migration = (Path(__file__).parents[1] / "migrations" / "0024_backfill_subtopic_completion_events.sql").read_text()
    body = migration[migration.index("begin;") + len("begin;"):migration.rindex("commit;")]
    await session.execute(text(body))
    await session.commit()

    event = (await session.execute(text("""
        select seen_at from public.user_subtopic_completions
         where user_id=:uid and subtopic_id=:sid
    """), {"uid": user, "sid": catalog[0].subtopic_id})).one()
    assert event.seen_at is not None
    item = next(item for item in await progress(session, user) if item.subtopic_slug == "probability")
    assert item.completed is True


async def test_authenticated_clients_cannot_mint_completion_events(session, user):
    catalog = await _probability_catalog(session)
    await session.execute(text("grant select,insert,update,delete on public.user_subtopic_completions to authenticated"))
    await session.execute(text("set local role authenticated"))
    with pytest.raises(Exception, match="row-level security"):
        await session.execute(text("""
            insert into public.user_subtopic_completions
              (user_id,subtopic_id,catalog_signature,catalog_concept_ids)
            values (:uid,:sid,repeat('0',64),cast(:concept_ids as uuid[]))
        """), {"uid": user, "sid": catalog[0].subtopic_id, "concept_ids": [catalog[0].id]})
    await session.rollback()

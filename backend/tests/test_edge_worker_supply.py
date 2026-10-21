"""Scheduled demand planning preserves the reader's durable reserve."""

from datetime import date, timedelta

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_active_reader_target_advances_only_with_consumption(session, user):
    topic = await session.scalar(text("""select topic_id from public.concepts
      where status='published' group by topic_id having count(*)>=2
      order by count(*),topic_id limit 1"""))
    concepts = (await session.execute(text("""select id from public.concepts
      where topic_id=:tid and status='published' order by id"""),
      {"tid": topic})).scalars().all()
    assert len(concepts) >= 2
    await session.execute(text("""insert into public.user_topics(user_id,topic_id)
      values (:uid,:tid) on conflict do nothing"""), {"uid": user, "tid": topic})
    for offset, concept in enumerate(concepts[:-1]):
        await session.execute(text("""insert into public.daily_assignments(
          user_id,concept_id,assigned_for) values (:uid,:cid,:day)"""),
          {"uid": user, "cid": concept,
           "day": date(2025, 1, 1) + timedelta(days=offset)})
    await session.commit()
    assert await session.scalar(text("""select public.edge_worker_plan_active_readers(
      90,60,10)""")) >= 1
    target = await session.scalar(text("""select target_count from
      public.content_supply_targets where topic_id=:tid"""), {"tid": topic})
    assert target >= len(concepts) - 1 + 60
    await session.execute(text("""update public.content_supply_targets
      set target_count=:target where topic_id=:tid"""),
      {"target": target + 20, "tid": topic})
    await session.commit()
    await session.scalar(text("select public.edge_worker_plan_active_readers(90,60,10)"))
    assert await session.scalar(text("""select target_count from
      public.content_supply_targets where topic_id=:tid"""), {"tid": topic}) == target + 20
    await session.commit()

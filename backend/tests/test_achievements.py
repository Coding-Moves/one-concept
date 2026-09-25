"""Awards use accepted learning dates, real transactions and JWT ownership."""
import asyncio
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from app.services.achievements import acknowledge, award_streaks
from app.services.interactions import complete_today
from app.services.reviews import complete_review
from tests.test_api import client, anon_client  # noqa: F401
from tests.test_writes import _make_user

DAY = date(2026, 1, 1)


async def history(session, user, count, start=DAY):
    await session.execute(text("""
        insert into public.daily_reviews(user_id,concept_id,assigned_for,completed_at)
        select :uid,c.id,cast(:start as date)+n,now()
        from (select id from public.concepts limit 1) c cross join generate_series(0,:last) n
    """), {"uid": user, "start": start, "last": count-1})
    await session.commit()


async def earned(session, user):
    return (await session.execute(text("select * from public.user_achievements where user_id=:u order by earned_on"), {"u": user})).mappings().all()


@pytest.mark.parametrize('milestone', [7, 30, 90, 180, 365, 500, 1000, 5000, 10000])
async def test_thresholds_first_earned_date_and_replay(session, user, milestone):
    await history(session, user, milestone-1)
    await award_streaks(session, user)
    assert f'streak_{milestone}' not in [r['achievement_code'] for r in await earned(session, user)]
    await history(session, user, 1, DAY+timedelta(days=milestone-1))
    await award_streaks(session, user)
    await acknowledge(session, user, [f'streak_{milestone}'])
    await session.commit()
    before = [dict(r) for r in await earned(session, user)]
    await award_streaks(session, user)
    await session.commit()
    assert before == [dict(r) for r in await earned(session, user)]
    badge = next(r for r in before if r['achievement_code'] == f'streak_{milestone}')
    assert badge['earned_on'] == DAY+timedelta(days=milestone-1)
    assert badge['seen_at'] is not None


async def test_gaps_do_not_add_up_and_earned_badges_survive(session, user):
    await history(session, user, 4)
    await history(session, user, 3, DAY+timedelta(days=5))
    await award_streaks(session, user)
    assert not await earned(session, user)
    await history(session, user, 4, DAY+timedelta(days=8))
    await award_streaks(session, user)
    await session.commit()
    assert (await earned(session, user))[0]['earned_on'] == DAY+timedelta(days=11)
    await history(session, user, 7, DAY+timedelta(days=50))
    await award_streaks(session, user)
    await session.commit()
    assert len(await earned(session, user)) == 1
    assert (await earned(session, user))[0]['earned_on'] == DAY+timedelta(days=11)


async def test_lesson_and_review_union_grace_and_duplicate_day(session, user):
    await history(session, user, 6)
    await session.execute(text("""insert into public.daily_assignments(user_id,concept_id,assigned_for)
        select :u,id,:d from public.concepts limit 1"""), {'u': user, 'd': DAY+timedelta(days=6)})
    await session.commit()
    await complete_today(session, user, DAY+timedelta(days=7))
    assert (await earned(session, user))[0]['earned_on'] == DAY+timedelta(days=6)
    await history(session, user, 1, DAY+timedelta(days=6))
    await award_streaks(session, user)
    await session.commit()
    assert len(await earned(session, user)) == 1


async def test_review_two_devices_one_award(session, sessionmaker_for_test, user):
    await history(session, user, 7)
    rid = await session.scalar(text("update public.daily_reviews set completed_at=null where user_id=:u and assigned_for=:d returning id"), {'u': user, 'd': DAY+timedelta(days=6)})
    await session.commit()
    async def complete():
        async with sessionmaker_for_test() as other:
            await complete_review(other, user, rid, today=DAY+timedelta(days=6))
    await asyncio.gather(complete(), complete())
    assert len(await earned(session, user)) == 1


async def test_completion_rolls_back_when_award_fails(session, user, monkeypatch):
    await history(session, user, 7)
    rid = await session.scalar(text("update public.daily_reviews set completed_at=null where user_id=:u and assigned_for=:d returning id"), {'u': user, 'd': DAY+timedelta(days=6)})
    await session.commit()
    async def fail(*args):
        raise RuntimeError('award failed')
    monkeypatch.setattr('app.services.reviews.award_streaks', fail)
    with pytest.raises(RuntimeError):
        await complete_review(session, user, rid, today=DAY+timedelta(days=6))
    await session.rollback()
    assert await session.scalar(text('select completed_at from public.daily_reviews where id=:id'), {'id': rid}) is None
    assert not await earned(session, user)


async def test_historical_backfill_preserves_dates_and_acknowledgement(session, user):
    await history(session, user, 30)
    sql = (Path(__file__).parents[1]/'migrations/0016_achievements.sql').read_text()
    backfill = sql[sql.index('with days as'):sql.rindex('commit;')]
    await session.execute(text(backfill))
    await session.commit()
    awards = await earned(session, user)
    assert [(a['achievement_code'], a['source']) for a in awards] == [('streak_7','history'), ('streak_30','history')]
    assert awards[0]['earned_on'] == DAY+timedelta(days=6)
    await acknowledge(session, user, ['streak_7'])
    await session.commit()
    await session.execute(text(backfill))
    assert (await earned(session, user))[0]['seen_at'] is not None


async def test_api_ownership_and_ack_cannot_grant_awards(client, session, user):
    other = await _make_user(session)
    await history(session, other, 7)
    await award_streaks(session, other)
    await session.commit()
    response = await client.get('/v1/me/achievements')
    assert response.status_code == 200
    assert len(response.json()['items']) == 9
    assert all(a['earned_on'] is None for a in response.json()['items'])
    assert (await client.post('/v1/me/achievements/seen', json={'codes':['streak_7']})).status_code == 204
    assert not await earned(session, user)
    assert (await earned(session, other))[0]['seen_at'] is None
    assert (await client.post('/v1/me/achievements/seen', json={'codes':[]})).status_code == 422


async def test_achievements_require_authentication(anon_client):
    assert (await anon_client.get('/v1/me/achievements')).status_code == 401
    assert (await anon_client.post('/v1/me/achievements/seen', json={'codes':['streak_7']})).status_code == 401


async def test_client_roles_cannot_mint_awards(session, user):
    await session.execute(text('grant select,insert,update,delete on public.user_achievements to authenticated'))
    await session.execute(text('set local role authenticated'))
    with pytest.raises(Exception, match='row-level security'):
        await session.execute(text("insert into public.user_achievements(user_id,achievement_code,earned_on,source) values (:u,'streak_7',current_date,'completion')"), {'u': user})
    await session.rollback()

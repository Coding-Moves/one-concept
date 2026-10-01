"""Mutual relationships: JWT ownership, pair serialization and current privacy."""
import math
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from sqlalchemy import text

from app.schemas.connections import ConnectionEntry, ConnectionPage, ConnectionStatus

REQUEST_LIMIT = 20
PENDING_LIMIT = 100
COOLDOWN = timedelta(days=7)


def unavailable():
    return HTTPException(404, 'This connection is unavailable')


async def lock_pair(db, actor, peer):
    # Stable profile lock order serializes same pairs and each sender's limits.
    await db.execute(text('select id from profiles where id in (:a,:b) order by id for update'), {'a': actor, 'b': peer})


async def blocked(db, actor, peer):
    return await db.scalar(text('''select exists(select 1 from connection_blocks
        where (owner_id=:a and target_id=:b) or (owner_id=:b and target_id=:a))'''), {'a': actor, 'b': peer})


async def pair_row(db, actor, peer):
    low, high = sorted([actor, peer])
    return (await db.execute(text('select * from connections where low_user=:low and high_user=:high'), {'low': low, 'high': high})).first()


async def peer_for_token(db, token):
    return await db.scalar(text('select user_id from profile_sharing where public_token=:token and enabled'), {'token': token})


async def visible_peer(db, token, actor, *, lock=False):
    peer = await peer_for_token(db, token)
    if peer is None:
        raise unavailable()
    if lock:
        await lock_pair(db, actor, peer)
        # Lock privacy settings too: request vs revoke has a defined order.
        current = await db.scalar(text('select user_id from profile_sharing where public_token=:token and enabled for share'), {'token': token})
        if current != peer:
            raise unavailable()
    if await blocked(db, actor, peer):
        raise unavailable()
    return peer


def remaining_cooldown(row):
    if row and row.state in ('declined', 'canceled', 'removed'):
        return max(0, math.ceil((row.changed_at + COOLDOWN - datetime.now(timezone.utc)).total_seconds()))
    return 0


async def status_for(db, actor, peer):
    if actor == peer:
        return ConnectionStatus(state='self')
    row = await pair_row(db, actor, peer)
    if row and row.state in ('pending', 'accepted'):
        return ConnectionStatus(id=row.id, state='accepted' if row.state == 'accepted' else 'outgoing' if row.initiator == actor else 'incoming')
    cooldown = remaining_cooldown(row)
    if cooldown:
        return ConnectionStatus(state='cooldown', retry_after=cooldown)
    accepting = await db.scalar(text('select accepting_requests from connection_preferences where user_id=:uid'), {'uid': peer})
    sharing = await db.scalar(text('select enabled from profile_sharing where user_id=:uid'), {'uid': actor})
    return ConnectionStatus(state='available' if accepting and sharing else 'unavailable')


async def request_connection(db, actor, token):
    peer = await visible_peer(db, token, actor, lock=True)
    if actor == peer:
        raise HTTPException(400, 'You cannot connect with yourself')
    row = await pair_row(db, actor, peer)
    if row and row.state == 'accepted':
        return ConnectionStatus(state='accepted', id=row.id)
    if row and row.state == 'pending':
        if row.initiator == actor:
            return ConnectionStatus(state='outgoing', id=row.id)
        raise HTTPException(409, 'An incoming request already exists. Accept or decline it.')
    cooldown = remaining_cooldown(row)
    if cooldown:
        raise HTTPException(429, 'Please wait before requesting again', headers={'Retry-After': str(cooldown)})
    # Lock own visibility while making the explicit invitation disclosure.
    sharing = await db.scalar(text('select enabled from profile_sharing where user_id=:uid for share'), {'uid': actor})
    accepting = await db.scalar(text('select accepting_requests from connection_preferences where user_id=:uid for share'), {'uid': peer})
    if not sharing or not accepting:
        raise unavailable()
    count = await db.scalar(text("select count(*) from connection_request_events where user_id=:uid and requested_at > now()-interval '24 hours'"), {'uid': actor})
    pending = await db.scalar(text("select count(*) from connections where state='pending' and (low_user=:uid or high_user=:uid)"), {'uid': peer})
    own_pending = await db.scalar(text("select count(*) from connections where state='pending' and (low_user=:uid or high_user=:uid)"), {'uid': actor})
    if count >= REQUEST_LIMIT or pending >= PENDING_LIMIT or own_pending >= PENDING_LIMIT:
        raise HTTPException(429, 'Connection request limit reached. Try later.', headers={'Retry-After': '86400'})
    low, high = sorted([actor, peer])
    result = await db.scalar(text('''insert into connections(low_user,high_user,initiator,state)
        values (:low,:high,:actor,'pending') on conflict(low_user,high_user) do update
        set initiator=:actor,state='pending',requested_at=now(),changed_at=now() returning id'''), {'low': low, 'high': high, 'actor': actor})
    await db.execute(text('insert into connection_request_events(user_id) values (:uid)'), {'uid': actor})
    # Limit ledger retention as well as query work; keep only the rolling window.
    await db.execute(text("delete from connection_request_events where user_id=:uid and requested_at <= now()-interval '24 hours'"), {'uid': actor})
    await db.commit()
    return ConnectionStatus(state='outgoing', id=result)


async def owned_pair(db, actor, pair_id):
    row = (await db.execute(text('select * from connections where id=:id and (low_user=:uid or high_user=:uid)'), {'id': pair_id, 'uid': actor})).first()
    if row is None:
        raise unavailable()
    peer = row.high_user if row.low_user == actor else row.low_user
    await lock_pair(db, actor, peer)
    return await pair_row(db, actor, peer), peer


async def block_peer(db, actor, peer):
    if actor == peer:
        raise HTTPException(400, 'You cannot block yourself')
    await db.execute(text('insert into connection_blocks(owner_id,target_id) values (:a,:b) on conflict(owner_id,target_id) do nothing'), {'a': actor, 'b': peer})
    await db.execute(text("update connections set state='removed',changed_at=now() where low_user=:low and high_user=:high and state in ('pending','accepted')"), {'low': min(actor, peer), 'high': max(actor, peer)})
    await db.commit()


async def act(db, actor, pair_id, action):
    row, peer = await owned_pair(db, actor, pair_id)
    if action == 'block':
        await block_peer(db, actor, peer)
        return
    if await blocked(db, actor, peer):
        raise unavailable()
    if action in ('accept', 'decline') and row.initiator == actor:
        raise HTTPException(403, 'Only the recipient can answer a request')
    if action == 'cancel' and row.initiator != actor:
        raise HTTPException(403, 'Only the sender can cancel a request')
    target = {'accept': 'accepted', 'decline': 'declined', 'cancel': 'canceled', 'remove': 'removed'}[action]
    if row.state == target:
        return
    required = 'accepted' if action == 'remove' else 'pending'
    if row.state != required:
        raise HTTPException(409, 'This request has changed. Reload the list.')
    await db.execute(text('update connections set state=:state,changed_at=now() where id=:id'), {'state': target, 'id': row.id})
    await db.commit()


async def list_connections(db, actor, kind, cursor, limit):
    # Entries contain relationship IDs, never another account UUID or email.
    if kind == 'blocked':
        source = 'connection_blocks c'
        where = 'c.owner_id=:uid'
        peer = 'c.target_id'
    else:
        source = 'connections c'
        peer = 'case when c.low_user=:uid then c.high_user else c.low_user end'
        where = "(c.low_user=:uid or c.high_user=:uid) and c.state='accepted'" if kind == 'accepted' else "(c.low_user=:uid or c.high_user=:uid) and c.state='pending' and c.initiator " + ('<>' if kind == 'incoming' else '=') + ' :uid'
        where += f' and not exists(select 1 from connection_blocks b where (b.owner_id=:uid and b.target_id=({peer})) or (b.target_id=:uid and b.owner_id=({peer})))'
    rows = (await db.execute(text(f'''select c.id,
        case when s.enabled and s.show_name then coalesce(p.display_name,'One Concept learner') else 'Private learner' end as name,
        case when s.enabled then '/p/'||s.public_token else null end as path
        from {source} join profiles p on p.id=({peer}) left join profile_sharing s on s.user_id=p.id
        where {where} and (cast(:cursor as uuid) is null or c.id>cast(:cursor as uuid)) order by c.id limit :limit'''), {'uid': actor, 'cursor': cursor, 'limit': limit + 1})).all()
    items = [ConnectionEntry(id=r.id, display_name=r.name, public_path=r.path if kind != 'blocked' else None) for r in rows[:limit]]
    return ConnectionPage(items=items, next_cursor=items[-1].id if len(rows) > limit else None)

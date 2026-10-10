"""Directed profile connections with a deliberately small public surface."""
import asyncio
from datetime import datetime

import httpx
from fastapi import HTTPException
from sqlalchemy import text

from app.schemas.relationships import RelationshipEntry, RelationshipPage, RelationshipStatus
from app.config import get_settings
from app.services.profile_avatar import is_preset, is_object_key, signed_avatar_url

CONNECT_LIMIT = 40


def unavailable():
    # Do not disclose whether a profile was revoked, private, blocked, or absent.
    return HTTPException(404, 'This profile is unavailable')


async def lock_people(db, actor, peer):
    await db.execute(text('select id from profiles where id in (:actor, :peer) order by id for update'), {'actor': actor, 'peer': peer})


async def is_blocked(db, actor, peer):
    return await db.scalar(text('''select exists(select 1 from connection_blocks
        where (owner_id=:actor and target_id=:peer) or (owner_id=:peer and target_id=:actor))'''), {'actor': actor, 'peer': peer})


async def peer_for_visible_token(db, actor, token, *, lock=False):
    peer = await db.scalar(text('select user_id from profile_sharing where public_token=:token and enabled'), {'token': token})
    if peer is None:
        raise unavailable()
    if lock:
        await lock_people(db, actor, peer)
        peer = await db.scalar(text('select user_id from profile_sharing where public_token=:token and enabled for share'), {'token': token})
        if peer is None:
            raise unavailable()
    if peer == actor or await is_blocked(db, actor, peer):
        raise unavailable()
    return peer


async def status(db, actor, token):
    try:
        peer = await peer_for_visible_token(db, actor, token)
    except HTTPException as exc:
        if exc.status_code == 404:
            return RelationshipStatus(state='unavailable')
        raise
    row = (await db.execute(text('''select id from profile_connections
        where source_user_id=:actor and target_user_id=:peer'''), {'actor': actor, 'peer': peer})).first()
    return RelationshipStatus(state='connected' if row else 'available', relationship_id=row.id if row else None)


async def connect(db, actor, token):
    peer = await peer_for_visible_token(db, actor, token, lock=True)
    # Rate limit only a new directed relationship. Repeated taps are idempotent
    # and must not consume the daily allowance.
    exists = await db.scalar(text('''select id from profile_connections
        where source_user_id=:actor and target_user_id=:peer'''), {'actor': actor, 'peer': peer})
    if exists:
        return RelationshipStatus(state='connected', relationship_id=exists)
    count = await db.scalar(text("select count(*) from connection_request_events where user_id=:actor and requested_at > now()-interval '24 hours'"), {'actor': actor})
    if count >= CONNECT_LIMIT:
        raise HTTPException(429, 'Connection limit reached. Try again tomorrow.', headers={'Retry-After': '86400'})
    relationship_id = await db.scalar(text('''insert into profile_connections(source_user_id,target_user_id)
        values (:actor,:peer) returning id'''), {'actor': actor, 'peer': peer})
    # Existing owner-only event storage is reused as an internal mutation
    # ledger. It contains no target identity and keeps rate limiting bounded.
    await db.execute(text('insert into connection_request_events(user_id) values (:actor)'), {'actor': actor})
    await db.execute(text("delete from connection_request_events where user_id=:actor and requested_at <= now()-interval '24 hours'"), {'actor': actor})
    await db.commit()
    return RelationshipStatus(state='connected', relationship_id=relationship_id)


async def disconnect(db, actor, relationship_id):
    # The opaque relationship id is owner-fenced. It is necessary so an owner
    # can still disconnect after the other learner turns public sharing off.
    row = (await db.execute(text('''select target_user_id from profile_connections
        where id=:id and source_user_id=:actor for update'''), {'id': relationship_id, 'actor': actor})).first()
    if row is None:
        return
    await lock_people(db, actor, row.target_user_id)
    await db.execute(text('delete from profile_connections where id=:id and source_user_id=:actor'), {'id': relationship_id, 'actor': actor})
    await db.commit()


async def block(db, actor, token):
    peer = await peer_for_visible_token(db, actor, token, lock=True)
    await db.execute(text('''insert into connection_blocks(owner_id,target_id) values (:actor,:peer)
        on conflict(owner_id,target_id) do nothing'''), {'actor': actor, 'peer': peer})
    # A block removes both people's directed entries. It is the only operation
    # that changes the other person's list, because blocking is a safety tool.
    await db.execute(text('''delete from profile_connections where
        (source_user_id=:actor and target_user_id=:peer) or (source_user_id=:peer and target_user_id=:actor)'''), {'actor': actor, 'peer': peer})
    await db.commit()


async def block_relationship(db, actor, relationship_id):
    """An owner can block someone already in their list even after link revocation."""
    peer = await db.scalar(text('''select target_user_id from profile_connections
        where id=:id and source_user_id=:actor'''), {'id': relationship_id, 'actor': actor})
    if peer is None:
        return
    await lock_people(db, actor, peer)
    current_peer = await db.scalar(text('''select target_user_id from profile_connections
        where id=:id and source_user_id=:actor for update'''), {'id': relationship_id, 'actor': actor})
    if current_peer != peer:
        return
    await db.execute(text('''insert into connection_blocks(owner_id,target_id) values (:actor,:peer)
        on conflict(owner_id,target_id) do nothing'''), {'actor': actor, 'peer': peer})
    await db.execute(text('''delete from profile_connections where
        (source_user_id=:actor and target_user_id=:peer) or (source_user_id=:peer and target_user_id=:actor)'''),
        {'actor': actor, 'peer': peer})
    await db.commit()


async def list_relationships(db, actor, cursor, limit):
    params = {'actor': actor, 'limit': limit + 1, 'created': None, 'id': None}
    predicate = ''
    if cursor:
        try:
            # ISO 8601 timestamps contain colons (including their UTC offset),
            # so split from the right to preserve the timestamp as one value.
            created_raw, row_id = cursor.rsplit(':', 1)
            params['created'] = datetime.fromisoformat(created_raw.replace('Z', '+00:00'))
            params['id'] = row_id
            predicate = 'and (r.created_at, r.id) < (cast(:created as timestamptz), cast(:id as uuid))'
        except (ValueError, TypeError):
            raise HTTPException(422, 'Invalid cursor')
    rows = (await db.execute(text(f'''select r.id, r.created_at,
        case when s.enabled and s.show_name then coalesce(p.display_name, 'One Concept learner') else 'Private learner' end as display_name,
        case when s.enabled then '/p/' || s.public_token else null end as public_path,
        case when s.enabled and s.show_avatar then p.avatar_url else null end as shared_avatar
        from profile_connections r
        join profiles p on p.id=r.target_user_id
        left join profile_sharing s on s.user_id=p.id
        where r.source_user_id=:actor {predicate}
          and not exists(select 1 from connection_blocks b where
            (b.owner_id=:actor and b.target_id=r.target_user_id) or
            (b.owner_id=r.target_user_id and b.target_id=:actor))
        order by r.created_at desc, r.id desc limit :limit'''), params)).all()
    semaphore = asyncio.Semaphore(6)

    async def entry(row):
        avatar_ref = row.shared_avatar if is_preset(row.shared_avatar) else None
        avatar_url = None
        if is_object_key(row.shared_avatar):
            try:
                async with semaphore:
                    avatar_url = await signed_avatar_url(get_settings(), row.shared_avatar)
            except (httpx.RequestError, ValueError):
                # A transient Storage failure must not hide the owned list.
                avatar_url = None
        return RelationshipEntry(id=row.id, display_name=row.display_name,
                                 public_path=row.public_path, avatar_ref=avatar_ref, avatar_url=avatar_url)

    items = await asyncio.gather(*(entry(row) for row in rows[:limit]))
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = f'{last.created_at.isoformat()}:{last.id}'
    return RelationshipPage(items=items, next_cursor=next_cursor)

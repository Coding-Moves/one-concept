from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import text

from app.api.v1.profile_sharing import DB, User, HEADERS, validate_token
from app.schemas.connections import ConnectionAction, ConnectionPage, ConnectionPreferences, ConnectionStatus
from app.services import connections as service

router = APIRouter(prefix='/me/connections', tags=['connections'])


@router.get('/settings', response_model=ConnectionPreferences)
async def settings(user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    row = (await db.execute(text('select accepting_requests,version from connection_preferences where user_id=:uid'), {'uid': user.id})).first()
    return ConnectionPreferences(accepting_requests=row.accepting_requests, version=row.version) if row else ConnectionPreferences(version=0)


@router.put('/settings', response_model=ConnectionPreferences)
async def save_settings(body: ConnectionPreferences, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    await service.lock_pair(db, user.id, user.id)
    await db.execute(text('insert into connection_preferences(user_id) values (:uid) on conflict(user_id) do nothing'), {'uid': user.id})
    row = (await db.execute(text('''update connection_preferences set accepting_requests=:accepting,version=version+1
        where user_id=:uid and version=:version returning accepting_requests,version'''), {'uid': user.id, 'accepting': body.accepting_requests, 'version': body.version})).first()
    if not row:
        raise HTTPException(409, 'Settings changed. Reload before saving.')
    await db.commit()
    return ConnectionPreferences(accepting_requests=row.accepting_requests, version=row.version)


@router.get('', response_model=ConnectionPage)
async def listing(user: User, db: DB, response: Response, kind: Literal['accepted', 'incoming', 'outgoing', 'blocked'] = 'accepted', cursor: UUID | None = None, limit: int = Query(default=25, ge=1, le=50)):
    response.headers.update(HEADERS)
    return await service.list_connections(db, user.id, kind, cursor, limit)


@router.get('/with/{token}', response_model=ConnectionStatus)
async def status(token: str, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    validate_token(token)
    try:
        peer = await service.visible_peer(db, token, user.id)
    except HTTPException as exc:
        if exc.status_code == 404:
            return ConnectionStatus(state='unavailable')
        raise
    return await service.status_for(db, user.id, peer)


@router.post('/with/{token}', response_model=ConnectionStatus)
async def request(token: str, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    validate_token(token)
    return await service.request_connection(db, user.id, token)


@router.post('/with/{token}/block', status_code=204)
async def block_public(token: str, user: User, db: DB):
    validate_token(token)
    peer = await service.visible_peer(db, token, user.id, lock=True)
    await service.block_peer(db, user.id, peer)
    return Response(status_code=204, headers=HEADERS)


@router.post('/{connection_id}/actions', status_code=204)
async def action(connection_id: UUID, body: ConnectionAction, user: User, db: DB):
    await service.act(db, user.id, connection_id, body.action)
    return Response(status_code=204, headers=HEADERS)


@router.delete('/blocks/{block_id}', status_code=204)
async def unblock(block_id: UUID, user: User, db: DB):
    peer = await db.scalar(text('select target_id from connection_blocks where id=:id and owner_id=:uid'), {'id': block_id, 'uid': user.id})
    if peer is None:
        # Idempotent and no information about another owner's block record.
        return Response(status_code=204, headers=HEADERS)
    await service.lock_pair(db, user.id, peer)
    await db.execute(text('delete from connection_blocks where id=:id and owner_id=:uid'), {'id': block_id, 'uid': user.id})
    await db.commit()
    return Response(status_code=204, headers=HEADERS)

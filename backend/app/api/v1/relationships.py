from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.v1.profile_sharing import DB, HEADERS, User, validate_token
from app.schemas.relationships import RelationshipPage, RelationshipStatus
from app.services import relationships as service

router = APIRouter(prefix='/me/relationships', tags=['relationships'])


@router.get('', response_model=RelationshipPage)
async def listing(user: User, db: DB, response: Response, cursor: str | None = None, limit: int = Query(default=25, ge=1, le=50)):
    response.headers.update(HEADERS)
    return await service.list_relationships(db, user.id, cursor, limit)


@router.get('/with/{token}', response_model=RelationshipStatus)
async def current_status(token: str, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    validate_token(token)
    return await service.status(db, user.id, token)


@router.post('/with/{token}', response_model=RelationshipStatus)
async def create(token: str, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    validate_token(token)
    return await service.connect(db, user.id, token)


@router.post('/with/{token}/block', status_code=204)
async def block(token: str, user: User, db: DB):
    validate_token(token)
    await service.block(db, user.id, token)
    return Response(status_code=204, headers=HEADERS)


@router.delete('/{relationship_id}', status_code=204)
async def remove(relationship_id: UUID, user: User, db: DB):
    await service.disconnect(db, user.id, relationship_id)
    return Response(status_code=204, headers=HEADERS)

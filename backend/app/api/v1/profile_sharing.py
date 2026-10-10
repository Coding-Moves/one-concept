import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.public_profile_page import render_public_page, render_unavailable_page
from app.schemas.profile_sharing import PublicProfile, SharingIn, SharingOut
from app.services.profile_sharing import public_profile, save_sharing, sharing_output, sharing_row

router = APIRouter(tags=['profile sharing'])
pages_router = APIRouter(tags=['public profile'])
DB = Annotated[AsyncSession, Depends(get_db)]
User = Annotated[CurrentUser, Depends(get_current_user)]
HEADERS = {'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
           'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'}


@router.get('/me/profile-sharing', response_model=SharingOut)
async def get_sharing(user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    result = sharing_output(await sharing_row(db, user.id))
    await db.commit()
    return result


@router.put('/me/profile-sharing', response_model=SharingOut)
async def put_sharing(body: SharingIn, user: User, db: DB, response: Response):
    response.headers.update(HEADERS)
    return await save_sharing(db, user.id, body)


def validate_token(token):
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        raise HTTPException(404, 'Profile unavailable', headers=HEADERS)


@router.get('/public-profiles/{token}', response_model=PublicProfile, response_model_exclude_none=True)
async def get_public_profile(token: str, db: DB, response: Response):
    response.headers.update(HEADERS)
    validate_token(token)
    return await public_profile(db, token)


@pages_router.get('/p/{token}', response_class=HTMLResponse, include_in_schema=False)
async def public_page(token: str, db: DB):
    validate_token(token)
    try:
        profile = await public_profile(db, token)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        html, csp = render_unavailable_page()
        return HTMLResponse(html, status_code=404, headers={**HEADERS, 'Content-Security-Policy': csp})
    html, csp = render_public_page(profile, token)
    return HTMLResponse(html, headers={**HEADERS, 'Content-Security-Policy': csp})

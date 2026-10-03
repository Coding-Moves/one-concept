import re
from html import escape
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
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
        return HTMLResponse(render_page('Profile unavailable', '<p>This link is private or no longer available.</p>'),
                            status_code=404, headers=HEADERS)
    sections = []
    if profile.current_streak is not None:
        sections.append(f'<p>Current streak: {profile.current_streak} days · Longest: {profile.longest_streak} days</p>')
    if profile.concepts_learned is not None:
        sections.append(f'<p>{profile.concepts_learned} concepts learned</p>')
    for a in profile.achievements:
        sections.append(f'<section><h2>{escape(a.name)}</h2><p>{escape(a.description)}</p></section>')
    if not sections:
        sections.append('<p>No learning highlights have been shared.</p>')
    # Expo Android package is an existing default scheme; verified HTTPS app
    # links remain a separately configured native/domain rollout.
    sections.append(f'<p><a href="com.codingmoves.oneconcept://p/{token}">Open in One Concept</a></p>')
    return HTMLResponse(render_page(profile.display_name or 'One Concept learner', ''.join(sections)),
                        headers={**HEADERS, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"})


def render_page(name, body):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>One Concept — shared profile</title><style>
:root{{color-scheme:light dark}}body{{margin:0;background:#f5f5fb;color:#202131;font:18px/1.6 system-ui}}
main{{max-width:600px;margin:3rem auto;padding:1.5rem;overflow-wrap:anywhere}}section{{padding:1rem 0}}
h1{{line-height:1.2}}h2{{font-size:1.1rem}}a{{color:#5045c8}}footer{{margin-top:3rem;font-size:.85rem}}
@media(prefers-color-scheme:dark){{body{{background:#0b0d15;color:#ededf5}}a{{color:#aca6ff}}}}
</style></head><body><main><h1>{escape(name)}</h1>{body}<footer>Shared with One Concept</footer></main></body></html>'''

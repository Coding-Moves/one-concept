import uuid
from dataclasses import dataclass

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.errors import unauthorized
from app.core.security import verify_token
from app.db.session import get_db

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str | None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    """Identity comes from the verified token and nowhere else.

    No endpoint accepts a user id from the client, so there is no path by which
    a caller can act as somebody other than the subject of their own token.
    """
    if credentials is None or not credentials.credentials:
        raise unauthorized("Missing bearer token")

    claims = await verify_token(
        credentials.credentials, request.app.state.jwks, settings.jwt_issuer
    )

    try:
        user_id = uuid.UUID(claims.user_id)
    except ValueError:
        raise unauthorized("Token subject is not a valid user id")

    return CurrentUser(id=user_id, email=claims.email)


__all__ = ["CurrentUser", "get_current_user", "get_db", "AsyncSession"]

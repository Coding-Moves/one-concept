from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.services.interactions import set_interaction

router = APIRouter(prefix="/concepts", tags=["concepts"])

# PUT/DELETE rather than POST: a double tap on a flaky connection converges on
# the same state instead of toggling twice.
_NO_CONTENT = Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{slug}/like", status_code=status.HTTP_204_NO_CONTENT)
async def like(slug: str, user: CurrentUser = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)) -> Response:
    await set_interaction(db, user.id, slug, "liked_at", True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{slug}/like", status_code=status.HTTP_204_NO_CONTENT)
async def unlike(slug: str, user: CurrentUser = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> Response:
    await set_interaction(db, user.id, slug, "liked_at", False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{slug}/save", status_code=status.HTTP_204_NO_CONTENT)
async def save(slug: str, user: CurrentUser = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)) -> Response:
    await set_interaction(db, user.id, slug, "saved_at", True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{slug}/save", status_code=status.HTTP_204_NO_CONTENT)
async def unsave(slug: str, user: CurrentUser = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> Response:
    await set_interaction(db, user.id, slug, "saved_at", False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

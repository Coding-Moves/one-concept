from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.me import LearnedOut, ProfileIn, StateOut, StreakOut, TopicsIn
from app.services.interactions import set_followed_topics
from app.services.state import load_state
from app.services.streaks import compute_streaks
from app.services.users import ensure_bootstrapped

router = APIRouter(prefix="/me", tags=["me"])


def _to_state_out(state) -> StateOut:
    return StateOut(
        display_name=state.display_name,
        timezone=state.timezone,
        today=state.today,
        followed_topics=state.followed_topics,
        learned=[LearnedOut(concept_slug=r.concept_slug, learned_on=r.learned_on) for r in state.learned],
        likes=state.likes,
        bookmarks=state.bookmarks,
        stats=StreakOut(**vars(state.stats)),
        assignment_slug=state.assignment_slug,
    )


@router.get("/state", response_model=StateOut)
async def get_state(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StateOut:
    """Everything the app needs to render, in one request.

    Bootstrapping only runs when the state query finds no profile, so the
    common path costs a single round trip.
    """
    state = await load_state(db, user.id)
    if state is None:
        await ensure_bootstrapped(db, user.id, user.email)
        await db.commit()
        state = await load_state(db, user.id)
    return _to_state_out(state)


@router.get("/stats", response_model=StreakOut)
async def get_stats(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreakOut:
    return StreakOut(**vars(await compute_streaks(db, user.id)))


@router.put("/topics", response_model=StateOut)
async def put_topics(
    body: TopicsIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StateOut:
    await set_followed_topics(db, user.id, body.topics)
    return _to_state_out(await load_state(db, user.id))


@router.patch("", response_model=StateOut)
async def patch_profile(
    body: ProfileIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StateOut:
    if body.timezone is not None:
        # Reject unknown zones here: a bad value would silently shift every
        # future day boundary and streak for this user.
        valid = await db.scalar(text("select now() at time zone :tz is not null"), {"tz": body.timezone})
        if not valid:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown timezone")
        await db.execute(
            text("update public.profiles set timezone = :tz where id = :uid"),
            {"tz": body.timezone, "uid": user.id},
        )
    if body.display_name is not None:
        await db.execute(
            text("update public.profiles set display_name = :n where id = :uid"),
            {"n": body.display_name, "uid": user.id},
        )
    await db.commit()
    return _to_state_out(await load_state(db, user.id))

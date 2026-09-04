from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps import CurrentUser, get_current_user
from app.schemas.me import LearnedOut, ProfileIn, StateOut, StreakOut, TopicsIn
from app.schemas.notifications import NotificationPrefs, PushTokenIn
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
        learned=[
            LearnedOut(concept_slug=r.concept_slug, learned_on=r.learned_on,
                       title=r.title, topic_name=r.topic_name)
            for r in state.learned
        ],
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


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_token(
    body: PushTokenIn,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Register (or re-home) this handset's Expo push token.

    Tokens are unique per handset, not per account: signing into a different
    account on the same phone moves the token to its new owner, so reminders
    follow the person actually holding the device.
    """
    await db.execute(
        text("""
            insert into public.device_tokens (user_id, expo_push_token, platform)
            values (:uid, :token, :platform)
            on conflict (expo_push_token)
            do update set user_id = excluded.user_id,
                          platform = coalesce(excluded.platform, device_tokens.platform),
                          last_seen_at = now()
        """),
        {"uid": user.id, "token": body.expo_push_token, "platform": body.platform},
    )
    await db.commit()


@router.delete("/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def deregister_push_token(
    body: PushTokenIn | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Stop reminders following an account off a handset it no longer holds.

    Called on sign-out, while the session is still valid. Scoped to the
    caller's own registrations: you cannot deregister someone else's device
    by guessing their token.

    The body is optional on purpose: DELETE bodies have no defined HTTP
    semantics and an intermediary may strip them. With no token we fail
    CLOSED and drop every registration the caller has — a signed-out user
    briefly losing reminders on a second device (fixed by its next app open)
    beats a silent 422 that leaves reminders following a surrendered handset.
    """
    if body is None:
        await db.execute(
            text("delete from public.device_tokens where user_id = :uid"),
            {"uid": user.id},
        )
    else:
        await db.execute(
            text("""
                delete from public.device_tokens
                 where expo_push_token = :token and user_id = :uid
            """),
            {"token": body.expo_push_token, "uid": user.id},
        )
    await db.commit()


async def _load_prefs(db: AsyncSession, user_id) -> NotificationPrefs:
    row = (await db.execute(
        text("select enabled, reminder_times from public.notification_preferences where user_id = :uid"),
        {"uid": user_id},
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No preferences yet")
    return NotificationPrefs(
        enabled=row.enabled,
        reminder_times=[t.strftime("%H:%M") for t in row.reminder_times],
    )


@router.get("/notifications", response_model=NotificationPrefs)
async def get_notifications(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPrefs:
    return await _load_prefs(db, user.id)


@router.put("/notifications", response_model=NotificationPrefs)
async def put_notifications(
    body: NotificationPrefs,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPrefs:
    await db.execute(
        text("""
            update public.notification_preferences
               set enabled = :enabled,
                   reminder_times = cast(:times as time[])
             where user_id = :uid
        """),
        {"enabled": body.enabled, "times": body.reminder_times, "uid": user.id},
    )
    await db.commit()
    return await _load_prefs(db, user.id)


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

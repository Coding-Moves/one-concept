import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Covers the same ground as the on_auth_user_created trigger. The trigger
# covers normal signups; this is the safety net for users that predate the
# schema or were created through paths the trigger did not see.
#
# Keep the two inserts in one round trip: this runs on every /v1/daily call
# (and on /v1/me/state only when no profile exists yet).
#
# Topic follows are always opt-in, including for users whose signup trigger
# did not run. Profile and prefs are single rows that users cannot delete, so
# re-asserting them stays harmless.
_BOOTSTRAP = text("""
    with profile as (
        insert into public.profiles (id, display_name)
        values (:uid, :display_name)
        on conflict (id) do nothing
        returning id
    )
    insert into public.notification_preferences (user_id)
    values (:uid)
    on conflict (user_id) do nothing
""")


async def ensure_bootstrapped(
    session: AsyncSession, user_id: uuid.UUID, email: str | None
) -> None:
    display_name = email.split("@")[0] if email else None
    await session.execute(_BOOTSTRAP, {"uid": user_id, "display_name": display_name})

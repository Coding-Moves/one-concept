import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Mirrors the on_auth_user_created trigger. The trigger covers everyone who
# signs up normally; this is the safety net for users that predate the schema,
# or that were created through paths the trigger did not see.
#
# Kept to one round trip: it runs on every /v1/daily and /v1/me/state call.
#
# Topic follows are seeded ONLY when the profile insert actually creates a
# row. Follows are the one user-curated, deletable set here — an unconditional
# insert would resurrect every unfollow on every call, which is exactly what
# it used to do (issue #29). Profile and prefs are single rows that users
# cannot delete, so re-asserting them stays harmless.
_BOOTSTRAP = text("""
    with created as (
        insert into public.profiles (id, display_name)
        values (:uid, :display_name)
        on conflict (id) do nothing
        returning id
    ), prefs as (
        insert into public.notification_preferences (user_id)
        values (:uid)
        on conflict (user_id) do nothing
    )
    insert into public.user_topics (user_id, topic_id)
    select p.id, t.id
      from created p
     cross join public.topics t
     where t.is_active
    on conflict do nothing
""")


async def ensure_bootstrapped(
    session: AsyncSession, user_id: uuid.UUID, email: str | None
) -> None:
    display_name = email.split("@")[0] if email else None
    await session.execute(_BOOTSTRAP, {"uid": user_id, "display_name": display_name})

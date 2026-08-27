import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Mirrors the on_auth_user_created trigger. The trigger covers everyone who
# signs up normally; this is the safety net for users that predate the schema,
# or that were created through paths the trigger did not see.
#
# Kept to one round trip: it runs on every /v1/daily and /v1/me/state call.
_BOOTSTRAP = text("""
    with profile as (
        insert into public.profiles (id, display_name)
        values (:uid, :display_name)
        on conflict (id) do nothing
    ), prefs as (
        insert into public.notification_preferences (user_id)
        values (:uid)
        on conflict (user_id) do nothing
    )
    insert into public.user_topics (user_id, topic_id)
    select :uid, t.id from public.topics t where t.is_active
    on conflict do nothing
""")


async def ensure_bootstrapped(
    session: AsyncSession, user_id: uuid.UUID, email: str | None
) -> None:
    display_name = email.split("@")[0] if email else None
    await session.execute(_BOOTSTRAP, {"uid": user_id, "display_name": display_name})

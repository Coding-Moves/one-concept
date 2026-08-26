import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Mirrors the on_auth_user_created trigger. The trigger covers everyone who
# signs up normally; this is the safety net for users that predate the schema,
# or that were created through paths the trigger did not see.
_BOOTSTRAP = (
    text("""
        insert into public.profiles (id, display_name)
        values (:uid, :display_name)
        on conflict (id) do nothing
    """),
    text("""
        insert into public.notification_preferences (user_id)
        values (:uid)
        on conflict (user_id) do nothing
    """),
    text("""
        insert into public.user_topics (user_id, topic_id)
        select :uid, t.id from public.topics t where t.is_active
        on conflict do nothing
    """),
)


async def ensure_bootstrapped(
    session: AsyncSession, user_id: uuid.UUID, email: str | None
) -> None:
    display_name = email.split("@")[0] if email else None
    for statement in _BOOTSTRAP:
        await session.execute(statement, {"uid": user_id, "display_name": display_name})

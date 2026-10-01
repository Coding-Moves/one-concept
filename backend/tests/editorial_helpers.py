"""Disposable confirmed reviewer identity for service-level publication tests."""

from uuid import uuid4

from sqlalchemy import text

from app.config import Settings
from app.deps import CurrentUser
from app.schemas.editorial import CAPABILITIES
from app.services.editorial_revisions import decide_revision, submit_revision
from app.services.publication import publish_revision
from app.services.content_quality import QualityReview
from tests.test_content_quality import review


async def identity(session):
    if "publication_identity" not in session.info:
        uid, sid = uuid4(), uuid4()
        email = f"{uid}@example.invalid"
        await session.execute(
            text("""insert into auth.users(id,email,email_confirmed_at)
            values (:id,:email,now())"""),
            {"id": uid, "email": email},
        )
        await session.execute(
            text("insert into auth.sessions(id,user_id) values (:sid,:uid)"),
            {"sid": sid, "uid": uid},
        )
        await session.execute(
            text("""insert into editorial_memberships
            (user_id,invited_email,capabilities,requested_name,approved_name)
            values (:uid,:email,:caps,'Registered Reviewer','Registered Reviewer')"""),
            {"uid": uid, "email": email, "caps": CAPABILITIES},
        )
        session.info["publication_identity"] = (
            CurrentUser(uid, email, str(sid), "aal2"),
            Settings(
                _env_file=None,
                database_url="postgresql://unused",
                supabase_url="https://test.invalid",
                supabase_jwks_url="https://test.invalid/jwks",
                editorial_enabled=True,
            ),
        )
    return session.info["publication_identity"]


async def approve_and_publish(session, rid, reviewer, note, quality=None):
    # Legacy test call sites keep their intent; actual authority comes from the
    # confirmed account fixture, never this descriptive test label.
    if not reviewer.strip():
        raise ValueError("A reviewer is required")
    actor, settings = await identity(session)
    state = await session.scalar(
        text("select status from concept_revisions where id=:id"), {"id": rid}
    )
    if state == "draft":
        state = await submit_revision(session, rid, actor, settings, note)
    if state == "pending_review":
        await decide_revision(
            session,
            rid,
            actor,
            settings,
            "approved",
            note,
            quality or QualityReview.model_validate(review()),
        )
    return await publish_revision(session, rid, actor, settings)

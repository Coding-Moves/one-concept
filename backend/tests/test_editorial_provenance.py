import asyncio
import json
from dataclasses import replace

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services.content_quality import QualityReview
from app.services.editorial_revisions import (
    attest_legacy_version,
    decide_revision,
    published_provenance,
    submit_revision,
)
from app.services.publication import LessonBody, publish_revision, stage_revision
from tests.editorial_helpers import identity
from tests.test_content_quality import review
from tests import test_publication

draft = test_publication.draft

NOTE = "Checked the complete lesson package and its authoritative references."


async def pending(session, draft):
    actor, settings = await identity(session)
    rid = await session.scalar(
        text("select id from concept_revisions where concept_id=:id"), {"id": draft[1]}
    )
    assert (
        await submit_revision(session, rid, actor, settings, NOTE) == "pending_review"
    )
    return rid, actor, settings


async def approval(session, rid, actor, settings):
    return await decide_revision(
        session,
        rid,
        actor,
        settings,
        "approved",
        NOTE,
        QualityReview.model_validate(review()),
    )


async def test_exact_approval_is_immutable_and_names_are_snapshots(session, draft):
    rid, actor, settings = await pending(session, draft)
    aid = await approval(session, rid, actor, settings)
    assert (
        await session.scalar(
            text("select status from concepts where id=:id"), {"id": draft[1]}
        )
        == "draft"
    )
    for sql, params in [
        (
            "update concept_revisions set body=jsonb_set(body,'{title}','\"Forged title\"') where id=:id",
            {"id": rid},
        ),
        ("update concept_revisions set base_version=99 where id=:id", {"id": rid}),
        (
            "update editorial_revision_events set registered_name='Forged Name' where id=:id",
            {"id": aid},
        ),
        ("delete from editorial_revision_events where id=:id", {"id": aid}),
    ]:
        with pytest.raises(DBAPIError):
            async with session.begin_nested():
                await session.execute(text(sql), params)
    await session.execute(
        text(
            "update editorial_memberships set approved_name='New Name' where user_id=:id"
        ),
        {"id": actor.id},
    )
    assert await publish_revision(session, rid, actor, settings) == 1
    evidence = await published_provenance(session, draft[1], 1)
    assert evidence["registered_name"] == "Registered Reviewer"
    assert evidence["reviewer_id"] == actor.id
    assert await publish_revision(session, rid, actor, settings) == 1
    assert (
        await session.scalar(
            text("select count(*) from editorial_publications where concept_id=:id"),
            {"id": draft[1]},
        )
        == 1
    )
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(
                text("delete from editorial_publications where concept_id=:id"),
                {"id": draft[1]},
            )


@pytest.mark.parametrize("decision", ["changes_requested", "rejected", "retired"])
async def test_nonapproval_decisions_stay_private_and_require_new_revision(
    session, draft, decision
):
    rid, actor, settings = await pending(session, draft)
    await decide_revision(session, rid, actor, settings, decision, NOTE)
    with pytest.raises(ValueError):
        await publish_revision(session, rid, actor, settings)
    with pytest.raises(ValueError):
        await approval(session, rid, actor, settings)
    assert (
        await session.scalar(
            text("select status from concepts where id=:id"), {"id": draft[1]}
        )
        == "draft"
    )
    body = await session.scalar(
        text("select body from concept_revisions where id=:id"), {"id": rid}
    )
    new = await stage_revision(session, draft[0], LessonBody.model_validate(body))
    assert new != rid
    assert (
        await submit_revision(session, new, actor, settings, NOTE) == "pending_review"
    )


async def test_validation_failure_and_checklist_cannot_be_approved(session, draft):
    actor, settings = await identity(session)
    rid = await session.scalar(
        text("select id from concept_revisions where concept_id=:id"), {"id": draft[1]}
    )
    await session.execute(
        text("update concept_revisions set body=body-'learning_package' where id=:id"),
        {"id": rid},
    )
    assert (
        await submit_revision(session, rid, actor, settings, NOTE)
        == "validation_failed"
    )
    with pytest.raises(ValueError):
        await approval(session, rid, actor, settings)
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_revision_events where revision_id=:id and action='approved'"
            ),
            {"id": rid},
        )
        == 0
    )


async def test_roles_and_session_are_authoritative(session, draft):
    rid, actor, settings = await pending(session, draft)
    with pytest.raises(HTTPException):
        await approval(session, rid, replace(actor, aal="aal1"), settings)
    await session.execute(
        text(
            "update editorial_memberships set capabilities=array['review'] where user_id=:id"
        ),
        {"id": actor.id},
    )
    with pytest.raises(HTTPException):
        await approval(session, rid, actor, settings)
    await session.execute(
        text(
            "update editorial_memberships set capabilities=array['approve'] where user_id=:id"
        ),
        {"id": actor.id},
    )
    await approval(session, rid, actor, settings)
    with pytest.raises(HTTPException):
        await publish_revision(session, rid, actor, settings)
    assert await published_provenance(session, draft[1], 1) is None


@pytest.mark.parametrize("damage", ["retire", "version", "text", "taxonomy", "archive"])
async def test_approved_content_cannot_follow_changed_or_retired_source(
    session, draft, damage
):
    rid, actor, settings = await pending(session, draft)
    await approval(session, rid, actor, settings)
    if damage == "retire":
        await decide_revision(session, rid, actor, settings, "retired", NOTE)
    else:
        queries = {
            "version": "update concepts set content_version=content_version+1 where id=:id",
            "text": "update concepts set summary='Changed without a version bump' where id=:id",
            "taxonomy": "update subtopics set is_active=false where id=(select subtopic_id from concepts where id=:id)",
            "archive": "update concepts set status='archived' where id=:id",
        }
        await session.execute(text(queries[damage]), {"id": draft[1]})
    with pytest.raises(ValueError):
        await publish_revision(session, rid, actor, settings)
    assert await published_provenance(session, draft[1], 1) is None


async def test_correction_keeps_old_body_and_exact_provenance_until_publication(
    session, draft
):
    rid, actor, settings = await pending(session, draft)
    await approval(session, rid, actor, settings)
    await publish_revision(session, rid, actor, settings)
    old = await session.scalar(
        text("select summary from concepts where id=:id"), {"id": draft[1]}
    )
    body = LessonBody.model_validate(
        await session.scalar(
            text("select body from concept_revisions where id=:id"), {"id": rid}
        )
    )
    body.summary = (
        "A corrected explanation with a stable identity and retained history. " * 3
    )
    new = await stage_revision(session, draft[0], body)
    assert (
        await session.scalar(
            text("select summary from concepts where id=:id"), {"id": draft[1]}
        )
        == old
    )
    assert await published_provenance(session, draft[1], 1)
    await submit_revision(session, new, actor, settings, NOTE)
    await approval(session, new, actor, settings)
    assert await publish_revision(session, new, actor, settings) == 2
    assert await published_provenance(session, draft[1], 1) is None
    assert await published_provenance(session, draft[1], 2)
    assert await publish_revision(session, rid, actor, settings) == 1
    assert (
        await session.scalar(
            text("select content_version from concepts where id=:id"), {"id": draft[1]}
        )
        == 2
    )


async def test_simultaneous_approvals_record_one_identity(
    session, draft, sessionmaker_for_test
):
    rid, actor, settings = await pending(session, draft)
    await session.commit()

    async def decide():
        async with sessionmaker_for_test() as db:
            async with db.begin():
                return await approval(db, rid, actor, settings)

    results = await asyncio.gather(decide(), decide(), return_exceptions=True)
    assert sum(isinstance(r, ValueError) for r in results) == 1
    assert (
        await session.scalar(
            text(
                "select count(*) from editorial_revision_events where revision_id=:id and action='approved'"
            ),
            {"id": rid},
        )
        == 1
    )


async def test_cutover_inventory_is_exact_and_private(session, user):
    rows = (
        (await session.execute(text("select * from editorial_legacy_versions")))
        .mappings()
        .all()
    )
    assert rows
    # Fresh migration fixture inventories only seed content, with no reviewer.
    for row in rows:
        assert row["snapshot"]["id"] == str(row["concept_id"])
        assert row["snapshot"]["content_version"] == row["content_version"]
        assert (
            await published_provenance(
                session, row["concept_id"], row["content_version"]
            )
            is None
        )
    with pytest.raises(DBAPIError):
        async with session.begin_nested():
            await session.execute(
                text("update editorial_legacy_versions set content_version=99")
            )
    await session.execute(text("set local role authenticated"))
    for table in (
        "editorial_legacy_versions",
        "editorial_revision_events",
        "editorial_publications",
        "concept_revisions",
    ):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert not await session.scalar(
                text("select has_table_privilege(current_user,:t,:p)"),
                {"t": table, "p": privilege},
            )
    await session.rollback()


async def test_only_unchanged_complete_legacy_package_can_be_attested(session, draft):
    actor, settings = await identity(session)
    body = await session.scalar(
        text("select body from concept_revisions where concept_id=:id"),
        {"id": draft[1]},
    )
    await session.execute(
        text("""update concepts set status='published',content_version=1,
        flashcard=cast(:f as jsonb),mcqs=cast(:m as jsonb) where id=:id"""),
        {
            "id": draft[1],
            "f": json.dumps(body["learning_package"]["flashcard"]),
            "m": json.dumps(body["learning_package"]["mcqs"]),
        },
    )
    quality = QualityReview.model_validate(review())
    # A later import is NOT automatically grandfathered.
    with pytest.raises(ValueError, match="inventoried"):
        await attest_legacy_version(
            session, draft[1], 1, actor, settings, NOTE, quality
        )
    # Fixture simulates this exact record existing at the migration cutover.
    await session.execute(
        text("""insert into editorial_legacy_versions
        (concept_id,content_version,snapshot) select c.id,c.content_version,
        to_jsonb(c)-array['created_at','published_at','status'] from concepts c where id=:id"""),
        {"id": draft[1]},
    )
    await attest_legacy_version(session, draft[1], 1, actor, settings, NOTE, quality)
    assert await published_provenance(session, draft[1], 1)
    assert (
        await session.scalar(
            text("select content_version from concepts where id=:id"), {"id": draft[1]}
        )
        == 1
    )
    await session.execute(
        text("update concepts set summary='A later edit of legacy text' where id=:id"),
        {"id": draft[1]},
    )
    assert await published_provenance(session, draft[1], 1) is None
    with pytest.raises(ValueError, match="unchanged"):
        await attest_legacy_version(
            session, draft[1], 1, actor, settings, NOTE, quality
        )

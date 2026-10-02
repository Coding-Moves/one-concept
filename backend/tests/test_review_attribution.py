"""Learner contracts must never borrow another version's editorial evidence."""

import asyncio
import json

import pytest
from sqlalchemy import text

from app.services.content_quality import QualityReview
from app.services.editorial_revisions import attest_legacy_version, submit_revision
from app.services.publication import LessonBody, publish_revision, stage_revision
from tests.editorial_helpers import identity
from tests import test_api, test_publication
from tests.test_content_quality import review
from tests.test_editorial_provenance import NOTE, approval, pending

client = test_api.client
draft = test_publication.draft


async def assign(session, user, cid, surface):
    table = "daily_reviews" if surface == "review" else "daily_assignments"
    await session.execute(
        text(f"""insert into {table}(user_id,concept_id,assigned_for)
        values (:uid,:cid,(now() at time zone 'UTC')::date)"""),
        {"uid": user, "cid": cid},
    )
    await session.commit()


async def read(client, slug, surface):
    path = {
        "detail": f"/v1/concepts/{slug}",
        "daily": "/v1/daily",
        "state": "/v1/me/state",
        "review": "/v1/me/state?reviews=true",
    }[surface]
    response = await client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()
    if surface in ("state", "review"):
        body = body["review" if surface == "review" else "daily"]
    return body if surface == "detail" else body["concept"]


@pytest.mark.parametrize("surface", ["detail", "daily", "state", "review"])
async def test_public_attribution_follows_exact_published_version(
    client, session, user, draft, surface
):
    rid, actor, settings = await pending(session, draft)
    await approval(session, rid, actor, settings)
    await session.commit()
    # Approval without publication must not expose a draft or a reviewer badge.
    response = await client.get(f"/v1/concepts/{draft[0]}")
    assert response.status_code == 404
    await publish_revision(session, rid, actor, settings)
    await assign(session, user, draft[1], surface)
    original = await read(client, draft[0], surface)
    assert original["review"]["name"] == "Registered Reviewer"
    assert original["review"]["content_version"] == original["content_version"] == 1
    assert set(original["review"]) == {"name", "reviewed_at", "content_version"}
    assert original["review"]["reviewed_at"]
    assert str(actor.id) not in json.dumps(original)
    assert actor.email not in json.dumps(original)
    assert NOTE not in json.dumps(original)

    await session.execute(
        text(
            "update editorial_memberships set approved_name='Second Reviewer' where user_id=:id"
        ),
        {"id": actor.id},
    )
    body = LessonBody.model_validate(
        await session.scalar(
            text("select body from concept_revisions where id=:id"), {"id": rid}
        )
    )
    body.summary = (
        "A corrected explanation with stable identity and retained learning history. "
        * 3
    )
    correction = await stage_revision(session, draft[0], body)
    await session.commit()
    # Neither renaming the person nor creating a correction rewrites old evidence.
    assert await read(client, draft[0], surface) == original
    await submit_revision(session, correction, actor, settings, NOTE)
    await approval(session, correction, actor, settings)
    await publish_revision(session, correction, actor, settings)
    await session.commit()
    current = await read(client, draft[0], surface)
    assert current["summary"] == body.summary.strip()
    assert current["content_version"] == current["review"]["content_version"] == 2
    assert current["review"]["name"] == "Second Reviewer"
    # Out-of-band edits at the same version must not retain a false attribution.
    await session.execute(
        text("update concepts set summary='Changed outside review' where id=:id"),
        {"id": draft[1]},
    )
    await session.commit()
    assert (await read(client, draft[0], surface))["review"] is None


async def test_legacy_attestation_adds_evidence_without_replacing_body(
    client, session, user, draft
):
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
    # Historical free text is not authenticated approval.
    await session.execute(
        text(
            "update concept_revisions set reviewed_by='Untrusted historical name' where concept_id=:id"
        ),
        {"id": draft[1]},
    )
    await session.execute(
        text("""insert into editorial_legacy_versions(concept_id,content_version,snapshot)
        select c.id,c.content_version,to_jsonb(c)-array['created_at','published_at','status']
        from concepts c where id=:id"""),
        {"id": draft[1]},
    )
    await assign(session, user, draft[1], "daily")
    before = await read(client, draft[0], "detail")
    assert before["review"] is None
    await attest_legacy_version(
        session,
        draft[1],
        1,
        actor,
        settings,
        NOTE,
        QualityReview.model_validate(review()),
    )
    await session.commit()
    after = await read(client, draft[0], "detail")
    assert after["review"]["name"] == "Registered Reviewer"
    assert {**after, "review": None} == before
    assert (await read(client, draft[0], "state"))["review"] == after["review"]


async def test_concurrent_body_changes_never_mix_evidence(
    session, sessionmaker_for_test, user, draft
):
    from app.services.concepts import get_concept_out

    rid, actor, settings = await pending(session, draft)
    await approval(session, rid, actor, settings)
    await publish_revision(session, rid, actor, settings)
    await session.commit()
    original = await get_concept_out(session, user, draft[0])
    await session.commit()

    async def writer():
        async with sessionmaker_for_test() as db:
            for i in range(12):
                await db.execute(
                    text("update concepts set summary=:body where id=:id"),
                    {
                        "id": draft[1],
                        "body": original.summary
                        if i % 2
                        else "Unreviewed out-of-band text",
                    },
                )
                await db.commit()
                await asyncio.sleep(0)

    async def reader():
        async with sessionmaker_for_test() as db:
            for _ in range(16):
                concept = await get_concept_out(db, user, draft[0])
                if concept.review is not None:
                    assert concept.summary == original.summary
                    assert concept.review == original.review
                else:
                    assert concept.summary == "Unreviewed out-of-band text"
                await db.commit()
                await asyncio.sleep(0)

    await asyncio.gather(writer(), reader())

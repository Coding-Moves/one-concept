"""Authenticated HTTP commands over the existing editorial state machine.

Caller commits once. Account -> catalog locks serialize preconditions, receipts
and mutations. A receipt is replayed only after current authorization succeeds.
"""

import hashlib
import json

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

from app.services import editorial_revisions as revisions
from app.services.editorial_accounts import authorize, membership
from app.services.publication import stage_revision


def digest(value):
    return hashlib.sha256(
        json.dumps(
            jsonable_encoder(value), sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()


def revision_token(row):
    return digest(
        {
            key: row[key]
            for key in (
                "id",
                "concept_id",
                "base_version",
                "body",
                "status",
                "assigned_to",
                "source_snapshot",
                "concept_status",
                "topic_active",
                "subtopic_active",
                "subtopic_slug",
            )
        }
    )


def concept_token(row):
    return digest(
        {
            key: row[key]
            for key in (
                "snapshot",
                "status",
                "topic_active",
                "subtopic_active",
                "subtopic_slug",
            )
        }
    )


def expect(token, expected):
    if token != expected:
        raise HTTPException(
            409,
            detail={
                "code": "stale_revision",
                "message": "Content or review state changed. Reload before acting.",
            },
        )


async def concept(db, cid, *, lock=False):
    row = (
        (
            await db.execute(
                text(f"""select c.*,s.slug as subtopic_slug,
        t.is_active as topic_active,s.is_active as subtopic_active,
        {revisions.SNAPSHOT} as snapshot
        from concepts c join topics t on t.id=c.topic_id
        join subtopics s on s.id=c.subtopic_id where c.id=:id
        {"for update of c,t,s" if lock else ""}"""),
                {"id": cid},
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Concept not found")
    return row


async def audit(
    db, member, action, note, *, rid=None, cid=None, tid=None, details=None
):
    if len(note.strip()) < 10:
        raise ValueError("Record a substantive note of at least 10 characters")
    return await db.scalar(
        text("""insert into editorial_workflow_events
        (revision_id,concept_id,topic_id,actor_id,registered_name,action,note,details)
        values (:rid,:cid,:tid,:actor,:name,:action,:note,cast(:details as jsonb)) returning id"""),
        {
            "rid": rid,
            "cid": cid,
            "tid": tid,
            "actor": member.user_id,
            "name": member.approved_name,
            "action": action,
            "note": note.strip(),
            "details": json.dumps(jsonable_encoder(details or {})),
        },
    )


async def receipt(db, actor, command, resource):
    fingerprint = digest(
        {"resource": resource, "command": command.model_dump(mode="json")}
    )
    old = (
        (
            await db.execute(
                text("""select fingerprint,result from editorial_request_receipts
        where actor_id=:actor and request_id=:id"""),
                {"actor": actor.id, "id": command.request_id},
            )
        )
        .mappings()
        .first()
    )
    if old and old["fingerprint"] != fingerprint:
        raise HTTPException(409, "Request ID was already used for a different command")
    return fingerprint, old["result"] if old else None


async def remember(db, actor, command, fingerprint, result):
    result = jsonable_encoder(result)
    await db.execute(
        text("""insert into editorial_request_receipts
        (actor_id,request_id,fingerprint,result) values (:actor,:id,:f,cast(:result as jsonb))"""),
        {
            "actor": actor.id,
            "id": command.request_id,
            "f": fingerprint,
            "result": json.dumps(result),
        },
    )
    return result


async def revision_action(db, actor, settings, rid, command):
    cap = {
        "approved": "approve",
        "approve_and_publish": "approve",
        "retired": "approve",
        "publish": "publish",
        "assign": "manage_reviewers",
    }.get(command.action, "review")
    member = await revisions.lock_reviewer(db, actor, settings, cap)
    if command.action == "approve_and_publish":
        await authorize(db, actor, settings, "publish")
    fingerprint, old = await receipt(db, actor, command, f"revision:{rid}")
    if old is not None:
        return old
    row = await revisions.revision(db, rid)
    expect(revision_token(row), command.expected_token)
    if row["status"] == "generating":
        raise ValueError("Generation is still running; reload when the draft is ready")
    version = None
    if command.action == "submit":
        await revisions.submit_revision(db, rid, actor, settings, command.note)
    elif command.action in (
        "approved",
        "changes_requested",
        "rejected",
        "retired",
        "approve_and_publish",
    ):
        await revisions.decide_revision(
            db,
            rid,
            actor,
            settings,
            "approved" if command.action == "approve_and_publish" else command.action,
            command.note,
            command.quality,
        )
        if command.action == "approve_and_publish":
            version = await revisions.publish_reviewed_revision(
                db, rid, actor, settings, note=command.note
            )
    elif command.action == "publish":
        version = await revisions.publish_reviewed_revision(
            db, rid, actor, settings, note=command.note
        )
    elif command.action == "assign":
        revisions.current(row)
        if row["status"] in ("published", "retired"):
            raise ValueError("Only open review work can be assigned")
        if command.assignee_id is not None:
            assignee = await membership(db, command.assignee_id)
            if (
                assignee.status != "active"
                or assignee.approved_name is None
                or not set(assignee.capabilities).intersection({"review", "approve"})
            ):
                raise ValueError("Choose an active, approved reviewer")
        await db.execute(
            text("update concept_revisions set assigned_to=:uid where id=:id"),
            {"uid": command.assignee_id, "id": rid},
        )
        await audit(
            db,
            member,
            "assigned",
            command.note,
            rid=rid,
            cid=row["concept_id"],
            details={
                "previous_assignee": row["assigned_to"],
                "assignee": command.assignee_id,
            },
        )
    else:
        await audit(db, member, "comment", command.note, rid=rid, cid=row["concept_id"])
    updated = await revisions.revision(db, rid)
    return await remember(
        db,
        actor,
        command,
        fingerprint,
        {
            "revision_id": rid,
            "status": updated["status"],
            "token": revision_token(updated),
            "published_version": version,
        },
    )


async def stage(db, actor, settings, cid, command):
    member = await revisions.lock_reviewer(db, actor, settings, "review")
    fingerprint, old = await receipt(db, actor, command, f"stage:{cid}")
    if old is not None:
        return old
    row = await concept(db, cid, lock=True)
    expect(concept_token(row), command.expected_token)
    if (
        row["status"] == "archived"
        or not row["topic_active"]
        or not row["subtopic_active"]
    ):
        raise ValueError("Cannot stage retired content")
    rid = await stage_revision(db, row["slug"], command.body)
    await audit(
        db,
        member,
        "staged",
        command.note,
        rid=rid,
        cid=cid,
        details={"base_version": row["content_version"]},
    )
    new = await revisions.revision(db, rid)
    return await remember(
        db,
        actor,
        command,
        fingerprint,
        {"revision_id": rid, "status": "draft", "token": revision_token(new)},
    )


async def concept_action(db, actor, settings, cid, command):
    member = await revisions.lock_reviewer(db, actor, settings, "publish")
    if command.action == "attest":
        await authorize(db, actor, settings, "approve")
    fingerprint, old = await receipt(db, actor, command, f"concept:{cid}")
    if old is not None:
        return old
    row = await concept(db, cid, lock=True)
    expect(concept_token(row), command.expected_token)
    if command.action == "attest":
        await revisions.attest_legacy_version(
            db,
            cid,
            row["content_version"],
            actor,
            settings,
            command.note,
            command.quality,
        )
    else:
        if row["status"] not in ("published", "draft"):
            raise ValueError("Only published content or a draft can be retired here")
        await db.execute(
            text("update concepts set status='archived' where id=:id"), {"id": cid}
        )
        await audit(
            db,
            member,
            "content_retired",
            command.note,
            cid=cid,
            details={
                "content_version": row["content_version"],
                "snapshot": row["snapshot"],
            },
        )
    updated = await concept(db, cid)
    return await remember(
        db,
        actor,
        command,
        fingerprint,
        {
            "concept_id": cid,
            "status": updated["status"],
            "content_version": updated["content_version"],
            "token": concept_token(updated),
        },
    )


async def request_generation(db, actor, settings, command):
    member = await revisions.lock_reviewer(db, actor, settings, "request_generation")
    fingerprint, old = await receipt(db, actor, command, "generation")
    if old is not None:
        return old
    if not settings.generation_enabled:
        raise HTTPException(409, "Generation is disabled; no demand was recorded")
    if not await db.scalar(
        text("select exists(select 1 from topics where id=:id and is_active)"),
        {"id": command.topic_id},
    ):
        raise ValueError("Choose an active topic")
    planned = await db.scalar(
        text("""select count(*) from concept_backlog b
        join subtopics s on s.id=b.subtopic_id where b.topic_id=:id
        and b.status='pending' and s.is_active"""),
        {"id": command.topic_id},
    )
    if not planned:
        raise ValueError(
            "No pending curriculum is available; plan lessons before requesting generation"
        )
    inventory = await db.scalar(
        text("""select count(*) from concepts c
        join subtopics s on s.id=c.subtopic_id and s.is_active
        where c.topic_id=:id and c.status in ('published','draft')"""),
        {"id": command.topic_id},
    )
    from app.services.review_capacity import slots_available

    slots = await slots_available(db, command.topic_id, settings)
    if not slots:
        raise ValueError("Review backlog is full; review or archive existing drafts first")
    count = min(command.count, planned, settings.content_generation_batch, slots)
    # Repeated requests before generation coalesce instead of adding to the
    # outstanding target. Existing workers retain their quota/claim/kill checks.
    target = inventory + count
    target = await db.scalar(
        text("""insert into content_supply_targets(topic_id,target_count,expires_at)
        values (:id,:target,now()+make_interval(days=>:days)) on conflict(topic_id) do update set
        target_count=greatest(excluded.target_count,case when content_supply_targets.expires_at>now()
          then content_supply_targets.target_count else 0 end),
        requested_at=now(),expires_at=excluded.expires_at
        returning target_count"""),
        {
            "id": command.topic_id,
            "target": target,
            "days": settings.content_active_days,
        },
    )
    eid = await audit(
        db,
        member,
        "generation_requested",
        command.note,
        tid=command.topic_id,
        details={
            "requested_count": command.count,
            "bounded_count": count,
            "target": target,
        },
    )
    return await remember(
        db,
        actor,
        command,
        fingerprint,
        {"event_id": eid, "status": "demand_recorded", "target": target},
    )

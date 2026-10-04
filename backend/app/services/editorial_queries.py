"""Private, bounded read models. Text is data, never HTML or executable Markdown."""

import base64
import json
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

from app.services import editorial_revisions as revisions
from app.services import editorial_workflow as workflow
from app.services.publication import LessonBody, validate_candidate


async def queue(
    db,
    kind,
    status,
    topic_id,
    assignee_id,
    search,
    cursor,
    limit,
    subtopic_id=None,
    urgency=None,
):
    params = dict(
        status=status,
        topic=topic_id,
        assignee=assignee_id,
        search=search,
        cursor=cursor,
        take=limit + 1,
        subtopic=subtopic_id,
        urgency=urgency,
    )
    if kind in ("legacy", "published"):
        if status is not None or assignee_id is not None or urgency is not None:
            raise HTTPException(
                422, "Status, assignee and urgency apply to revisions only"
            )
        if kind == "legacy":
            join = "editorial_legacy_versions l"
            version = "l"
            extra = "not exists(select 1 from editorial_publications p where p.concept_id=c.id and p.content_version=c.content_version)"
            extra_select = f",(l.snapshot={revisions.SNAPSHOT}) as unchanged"
        else:
            join = "editorial_publications l"
            version = "l"
            extra = f"l.snapshot={revisions.SNAPSHOT}"
            extra_select = ",true as verified,(select e.registered_name from editorial_revision_events e where e.id=l.approval_id) as approved_by"
        query = f"""select c.id,c.slug,c.title,c.content_version,t.name as topic_name,
          s.name as subtopic_name,c.topic_id,c.subtopic_id,c.status {extra_select}
          from {join} join concepts c on {version}.concept_id=c.id
            and {version}.content_version=c.content_version
          join topics t on t.id=c.topic_id join subtopics s on s.id=c.subtopic_id
          where c.status='published' and {extra}
          and (cast(:topic as uuid) is null or c.topic_id=:topic)
          and (cast(:subtopic as uuid) is null or c.subtopic_id=:subtopic)
          and (:search='' or strpos(lower(c.title),lower(:search))>0)"""
    else:
        query = """select r.id,r.concept_id,c.slug,r.body->>'title' as title,r.status,
          r.base_version,r.assigned_to,r.review_due_at,r.created_at,c.content_version,
          t.name as topic_name,s.name as subtopic_name,c.topic_id,c.subtopic_id,
          (select e.registered_name from editorial_revision_events e
            where e.revision_id=r.id and e.action='approved' limit 1) as approved_by,
          (r.review_due_at<statement_timestamp() and r.status not in ('published','retired')) as overdue
          from concept_revisions r join concepts c on c.id=r.concept_id
          join topics t on t.id=c.topic_id join subtopics s on s.id=c.subtopic_id
          where ((cast(:status as text) is not null and r.status=:status)
            or (:status is null and r.status not in ('published','retired')))
          and (cast(:topic as uuid) is null or c.topic_id=:topic)
          and (cast(:subtopic as uuid) is null or c.subtopic_id=:subtopic)
          and (cast(:assignee as uuid) is null or r.assigned_to=:assignee)
          and (cast(:urgency as text) is null or
            (:urgency='overdue' and r.review_due_at<statement_timestamp() and r.status not in ('published','retired')) or
            (:urgency='scheduled' and r.review_due_at>=statement_timestamp() and r.status not in ('published','retired')) or
            (:urgency='unscheduled' and r.review_due_at is null))
          and (:search='' or strpos(lower(coalesce(r.body->>'title',c.title)),lower(:search))>0)"""
    # One statement: total and page describe the same database snapshot, including
    # an empty page. Total excludes the cursor so pagination doesn't shrink it.
    result = (
        (
            await db.execute(
                text(f"""with filtered as ({query}), page as (
      select * from filtered where (cast(:cursor as uuid) is null or id>:cursor)
      order by id limit :take)
      select (select count(*) from filtered) as total,
        coalesce((select jsonb_agg(to_jsonb(page) order by id) from page),'[]'::jsonb) as items"""),
                params,
            )
        )
        .mappings()
        .one()
    )
    rows = result["items"]
    return {
        "items": rows[:limit],
        "total": result["total"],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


async def taxonomy(db, cursor, limit):
    rows = (
        (
            await db.execute(
                text("""select s.id,s.name,s.is_active,t.id as topic_id,
      t.name as topic_name,t.is_active as topic_active from subtopics s join topics t on t.id=s.topic_id
      where (cast(:cursor as uuid) is null or s.id>:cursor) order by s.id limit :take"""),
                {"cursor": cursor, "take": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [dict(r) for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


def package(row):
    return {
        key: row[key]
        for key in (
            "title",
            "summary",
            "example",
            "curriculum",
            "subtopic_slug",
            "model",
            "prompt_version",
        )
    } | {"learning_package": {"flashcard": row["flashcard"], "mcqs": row["mcqs"]}}


async def validation(db, raw, source):
    errors = []
    try:
        body = LessonBody.model_validate(raw)
    except ValidationError as exc:
        errors = [
            {"field": ".".join(map(str, e["loc"])), "message": e["msg"]}
            for e in exc.errors(
                include_input=False, include_context=False, include_url=False
            )
        ]
    else:
        try:
            if (
                source["status"] == "archived"
                or not source["topic_active"]
                or not source["subtopic_active"]
            ):
                raise ValueError("Content or taxonomy is retired")
            if body.subtopic_slug != source["subtopic_slug"]:
                raise ValueError("Subtopic does not match the concept")
            await validate_candidate(db, source["slug"], source["id"], body)
        except ValueError as exc:
            errors.append({"field": "publication", "message": str(exc)})
    return {
        "valid": not errors,
        "errors": errors,
        "human_review_required": True,
        "checklist_version": 1,
    }


def source_links(raw):
    # Legacy/imported JSON is untrusted even when the package is invalid.
    curriculum = raw.get("curriculum") if isinstance(raw, dict) else None
    refs = curriculum.get("references", []) if isinstance(curriculum, dict) else []
    links = []
    if not isinstance(refs, list):
        return links
    for ref in refs[:10]:
        if not isinstance(ref, dict) or not isinstance(ref.get("url"), str):
            continue
        try:
            url = urlsplit(ref["url"])
            if (
                url.scheme in ("http", "https")
                and url.hostname
                and not url.username
                and not url.password
            ):
                links.append(
                    {
                        "title": str(ref.get("title", "Source"))[:200],
                        "url": ref["url"][:2083],
                    }
                )
        except ValueError:
            continue
    return links


async def revision_detail(db, rid):
    row = await revisions.revision(db, rid, lock=False)
    source = await workflow.concept(db, row["concept_id"])
    before = package(source)
    body = row["body"]
    fields = body if isinstance(body, dict) else {}
    result = await validation(db, body, source)
    if row["base_version"] != source["content_version"]:
        result["valid"] = False
        result["errors"].append(
            {
                "field": "base_version",
                "message": "Revision is stale; stage a new revision",
            }
        )
    return {
        "id": rid,
        "concept_id": row["concept_id"],
        "status": row["status"],
        "base_version": row["base_version"],
        "assigned_to": row["assigned_to"],
        "review_due_at": row["review_due_at"],
        "approved_by": await db.scalar(
            text(
                "select registered_name from editorial_revision_events where revision_id=:id and action='approved' limit 1"
            ),
            {"id": rid},
        ),
        "token": workflow.revision_token(row),
        "body": body,
        "source_status": source["status"],
        "source_body": before,
        "diff": [
            {"field": key, "before": before.get(key), "after": fields.get(key)}
            for key in sorted(set(before) | set(fields))
            if before.get(key) != fields.get(key)
        ],
        "validation": result,
        "source_links": source_links(body),
        "text_format": "markdown",
    }


async def concept_detail(db, cid):
    row = await workflow.concept(db, cid)
    inventory = await db.scalar(
        text("""select snapshot from editorial_legacy_versions
        where concept_id=:id and content_version=:v"""),
        {"id": cid, "v": row["content_version"]},
    )
    evidence = await revisions.published_provenance(db, cid, row["content_version"])
    body = package(row)
    return {
        "id": cid,
        "slug": row["slug"],
        "status": row["status"],
        "body": body,
        "content_version": row["content_version"],
        "token": workflow.concept_token(row),
        "unchanged_legacy": inventory == row["snapshot"],
        "provenance": dict(evidence) if evidence else None,
        "validation": await validation(db, body, row),
        "source_links": source_links(body),
        "text_format": "markdown",
    }


async def history(db, cid, cursor, limit):
    await workflow.concept(db, cid)
    rows = (
        (
            await db.execute(
                text("""select id,base_version,status,created_at,assigned_to
        from concept_revisions where concept_id=:id
        and (cast(:cursor as uuid) is null or id>:cursor) order by id limit :take"""),
                {"id": cid, "cursor": cursor, "take": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    return {
        "items": [dict(r) for r in rows[:limit]],
        "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None,
    }


def parse_cursor(cursor):
    if cursor is None:
        return None, None
    try:
        raw = json.loads(
            base64.b64decode(
                cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True
            )
        )
        at = datetime.fromisoformat(raw[0])
        if at.tzinfo is None or raw[1][:2] not in ("r:", "w:"):
            raise ValueError()
        UUID(raw[1][2:])
        return at, raw[1]
    except (ValueError, TypeError, IndexError, KeyError):
        raise HTTPException(422, "Invalid timeline cursor") from None


async def timeline(db, cid, cursor, limit):
    await workflow.concept(db, cid)
    at, eid = parse_cursor(cursor)
    rows = (
        (
            await db.execute(
                text("""with events as (
        select 'r:'||id::text as id,revision_id,actor_id,registered_name,action,note,
          jsonb_build_object('base_version',base_version,'checklist_version',checklist_version,
                             'quality_review',quality_review) as details,created_at
          from editorial_revision_events where concept_id=:cid
        union all select 'w:'||id::text,revision_id,actor_id,registered_name,action,note,details,created_at
          from editorial_workflow_events where concept_id=:cid)
        select * from events where (cast(:at as timestamptz) is null or (created_at,id)>(:at,:eid))
        order by created_at,id limit :take"""),
                {"cid": cid, "at": at, "eid": eid, "take": limit + 1},
            )
        )
        .mappings()
        .all()
    )
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps([last["created_at"].isoformat(), last["id"]]).encode()
            )
            .decode()
            .rstrip("=")
        )
    return {"items": [dict(r) for r in rows[:limit]], "next_cursor": next_cursor}

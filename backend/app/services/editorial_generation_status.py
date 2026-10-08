"""Private replenishment progress and actionable planning states; no raw errors."""

from fastapi import HTTPException
from sqlalchemy import text

from app.services.review_capacity import review_load
from app.services.supply import target_for


async def generation_status(db, tid, settings):
    active = await db.scalar(
        text("select is_active from topics where id=:id"), {"id": tid}
    )
    if active is None:
        raise HTTPException(404, "Topic not found")
    counts = (
        (
            await db.execute(
                text("""select
      (select count(*) from concepts c join subtopics s on s.id=c.subtopic_id
       where c.topic_id=:id and s.is_active and c.status='published') as published,
      (select count(*) from concepts c join subtopics s on s.id=c.subtopic_id
       where c.topic_id=:id and s.is_active and c.status='draft') as drafts,
      (select count(*) from concept_backlog b join subtopics s on s.id=b.subtopic_id
       where b.topic_id=:id and s.is_active and b.status='pending'
         and b.attempts<3+(select count(*) from content_retry_log l where l.backlog_id=b.id)) as pending,
      (select count(*) from concept_backlog b join subtopics s on s.id=b.subtopic_id
       where b.topic_id=:id and s.is_active and b.status='generating') as generating,
      (select count(*) from concept_backlog b join subtopics s on s.id=b.subtopic_id
       where b.topic_id=:id and s.is_active and b.status='failed') as failed,
      (select count(*) from concept_revisions r join concepts c on c.id=r.concept_id
       join subtopics s on s.id=c.subtopic_id where c.topic_id=:id and s.is_active
       and c.status<>'archived' and r.base_version=c.content_version
       and r.status in ('draft','pending_review','changes_requested','validation_failed','approved')) as ready_for_review
      """),
                {"id": tid},
            )
        )
        .mappings()
        .one()
    )
    load = await review_load(db, tid)
    target = await target_for(db, tid, settings.min_pool_per_topic)
    return {
        "topic_id": tid,
        "active": active,
        **dict(counts),
        "target": target,
        "review_load": load,
        "review_capacity": settings.content_review_backlog_limit,
        "review_blocked": load >= settings.content_review_backlog_limit,
        "planning_required": active
        and not counts["pending"]
        and not counts["generating"]
        and counts["published"] + counts["drafts"] < target,
        "generation_enabled": settings.generation_enabled and settings.future_refill_enabled,
        "provider_configured": bool(settings.gemini_api_key),
    }

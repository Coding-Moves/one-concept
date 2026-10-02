"""Bounded AI work waiting for humans, shared by manual and automatic demand."""

from sqlalchemy import text

from app.config import get_settings


async def review_load(db, topic_id):
    # Count concepts, not successive revisions of the same lesson. Unreviewed
    # drafts remain capacity even if rejected: explicitly archive unwanted work.
    return await db.scalar(
        text("""select
      (select count(*) from concepts c join subtopics s on s.id=c.subtopic_id
       where c.topic_id=:tid and s.is_active and (c.status='draft' or
         (c.status='published' and exists(select 1 from concept_revisions r
          where r.concept_id=c.id and r.base_version=c.content_version
            and r.status in ('draft','generating','validation_failed','pending_review','changes_requested','approved'))))) +
      (select count(*) from concept_backlog b join subtopics s on s.id=b.subtopic_id
       where b.topic_id=:tid and s.is_active and b.status='generating')"""),
        {"tid": topic_id},
    )


async def slots_available(db, topic_id, settings=None):
    return max(
        0,
        (settings or get_settings()).content_review_backlog_limit
        - await review_load(db, topic_id),
    )

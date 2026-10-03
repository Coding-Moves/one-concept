"""Server-authoritative subtopic progress and immutable completion events."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class SubtopicCompletion:
    id: uuid.UUID
    topic_slug: str
    topic_name: str
    subtopic_slug: str
    subtopic_name: str
    completed_at: datetime


@dataclass(frozen=True)
class SubtopicProgress:
    topic_slug: str
    topic_name: str
    subtopic_slug: str
    subtopic_name: str
    completed_concepts: int
    available_concepts: int
    completed: bool
    completion_id: uuid.UUID | None


# `md5` is built into PostgreSQL, unlike optional extension functions. The
# exact ordered UUID array is stored alongside it for auditability; clients
# never choose either value. Two salted digests give the stable 64-character
# key expected by the schema without relying on a managed extension.
def _signature(alias: str) -> str:
    return f"""md5(array_to_string({alias}.ids, ',')) ||
                md5('one-concept-subtopic-v1:' || array_to_string({alias}.ids, ','))"""

_INSERT_COMPLETION = text(f"""
    with target as (
      select s.id,s.slug as subtopic_slug,s.name as subtopic_name,
             t.slug as topic_slug,t.name as topic_name
        from public.concepts focus
        join public.subtopics s on s.id=focus.subtopic_id and s.is_active
        join public.topics t on t.id=s.topic_id and t.is_active
       where focus.id=:concept_id
    ), catalog as (
      select target.*,array_agg(c.id order by c.id) as ids,count(*)::int as available
        from target
        join public.concepts c on c.subtopic_id=target.id and c.status='published'
       group by target.id,target.subtopic_slug,target.subtopic_name,target.topic_slug,target.topic_name
    ), covered as (
      select catalog.*,count(done.concept_id)::int as completed
        from catalog
        left join public.user_concept_completions done
          on done.user_id=:uid and done.concept_id=any(catalog.ids)
       group by catalog.id,catalog.subtopic_slug,catalog.subtopic_name,catalog.topic_slug,catalog.topic_name,
                catalog.ids,catalog.available
    ), inserted as (
      insert into public.user_subtopic_completions
        (user_id,subtopic_id,catalog_signature,catalog_concept_ids)
      select :uid,id,{_signature('covered')},ids from covered
       where available > 0 and completed=available
      on conflict (user_id,subtopic_id,catalog_signature) do nothing
      returning id,subtopic_id,completed_at
    )
    select inserted.id,covered.topic_slug,covered.topic_name,
           covered.subtopic_slug,covered.subtopic_name,inserted.completed_at
      from inserted join covered on covered.id=inserted.subtopic_id
""")

_PROGRESS = text(f"""
    with catalog as (
      select t.slug as topic_slug,t.name as topic_name,
             s.id as subtopic_id,s.slug as subtopic_slug,s.name as subtopic_name,
             array_agg(c.id order by c.id) as ids,count(*)::int as available
        from public.topics t
        join public.subtopics s on s.topic_id=t.id and s.is_active
        join public.concepts c on c.subtopic_id=s.id and c.status='published'
       where t.is_active
       group by t.slug,t.name,s.id,s.slug,s.name
    ), progress as (
      select catalog.*,count(done.concept_id)::int as completed
        from catalog
        left join public.user_concept_completions done
          on done.user_id=:uid and done.concept_id=any(catalog.ids)
       group by catalog.topic_slug,catalog.topic_name,catalog.subtopic_id,
                catalog.subtopic_slug,catalog.subtopic_name,catalog.ids,catalog.available
    )
    select progress.topic_slug,progress.topic_name,progress.subtopic_slug,progress.subtopic_name,
           progress.completed,progress.available,
           (select event.id from public.user_subtopic_completions event
             where event.user_id=:uid and event.subtopic_id=progress.subtopic_id
               and event.catalog_signature={_signature('progress')}) as completion_id
      from progress
     order by progress.topic_name,progress.subtopic_name
""")


async def record_completion(
    session: AsyncSession, user_id: uuid.UUID, concept_id: uuid.UUID
) -> SubtopicCompletion | None:
    """Record one newly reached catalog boundary.

    The caller holds the profile lock used for daily completion. That lock
    serializes this user's devices; the unique catalog key is the final guard
    for retries and deployment overlap.
    """
    row = (await session.execute(
        _INSERT_COMPLETION, {"uid": user_id, "concept_id": concept_id}
    )).first()
    if row is None:
        return None
    return SubtopicCompletion(**dict(row._mapping))


async def progress(session: AsyncSession, user_id: uuid.UUID) -> list[SubtopicProgress]:
    rows = (await session.execute(_PROGRESS, {"uid": user_id})).mappings().all()
    return [
        SubtopicProgress(
            topic_slug=row["topic_slug"], topic_name=row["topic_name"],
            subtopic_slug=row["subtopic_slug"], subtopic_name=row["subtopic_name"],
            completed_concepts=row["completed"], available_concepts=row["available"],
            completed=row["completion_id"] is not None,
            completion_id=row["completion_id"],
        )
        for row in rows
    ]


async def acknowledge(session: AsyncSession, user_id: uuid.UUID, ids: list[uuid.UUID]) -> None:
    """Acknowledge only this account's already-issued completion events."""
    await session.execute(text("""
        update public.user_subtopic_completions set seen_at=coalesce(seen_at,now())
         where user_id=:uid and id=any(:ids)
    """), {"uid": user_id, "ids": ids})

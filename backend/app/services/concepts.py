"""Read a single concept for the detail view.

History and Saved lists carry only a concept's name/topic, not its body, so the
app fetches the full concept (summary + example) by slug when a card is opened.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Concept, ConceptInteraction, Topic
from app.schemas.daily import ConceptOut


async def get_concept_out(db: AsyncSession, user_id, slug: str) -> ConceptOut | None:
    """The published concept with the given slug, or None if there isn't one.

    like_count is other users' likes only — the client adds the viewer's own,
    exactly as the daily and state endpoints do, so the number matches the card.
    """
    like_count = (
        select(func.count())
        .select_from(ConceptInteraction)
        .where(
            ConceptInteraction.concept_id == Concept.id,
            ConceptInteraction.liked_at.is_not(None),
            ConceptInteraction.user_id != user_id,
        )
        .correlate(Concept)
        .scalar_subquery()
    )
    stmt = (
        select(Concept, Topic.slug, Topic.name, like_count)
        .join(Topic, Topic.id == Concept.topic_id)
        .where(Concept.slug == slug, Concept.status == "published")
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        return None
    concept, topic_slug, topic_name, likes = row
    return ConceptOut(
        id=concept.id,
        slug=concept.slug,
        title=concept.title,
        summary=concept.summary,
        example=concept.example,
        topic_slug=topic_slug,
        topic_name=topic_name,
        like_count=likes,
    )

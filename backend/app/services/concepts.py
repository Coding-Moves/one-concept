"""Read a single concept for the detail view.

History and Saved lists carry only a concept's name/topic, not its body, so the
app fetches the full concept (summary + example) by slug when a card is opened.
"""

from sqlalchemy import func, literal_column, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Concept, ConceptInteraction, Subtopic, Topic
from app.schemas.daily import ConceptOut
from app.services.review_attribution import REVIEW_ATTRIBUTION_SQL


async def get_concept_out(db: AsyncSession, user_id, slug: str) -> ConceptOut | None:
    """The published concept with the given slug, or None if there isn't one.

    like_count is other users' likes only — the client adds the viewer's own,
    exactly as the daily and state endpoints do, so the number matches the card.
    """
    c = aliased(Concept, name="c")
    review = literal_column(REVIEW_ATTRIBUTION_SQL, type_=JSONB).label("review")
    like_count = (
        select(func.count())
        .select_from(ConceptInteraction)
        .where(
            ConceptInteraction.concept_id == c.id,
            ConceptInteraction.liked_at.is_not(None),
            ConceptInteraction.user_id != user_id,
        )
        .correlate(c)
        .scalar_subquery()
    )
    stmt = (
        select(c, Topic.slug, Topic.name, Subtopic.slug, Subtopic.name, like_count, review)
        .join(Topic, Topic.id == c.topic_id)
        .join(Subtopic, Subtopic.id == c.subtopic_id)
        .where(c.slug == slug, c.status == "published")
    )
    row = (await db.execute(stmt.execution_options(populate_existing=True))).first()
    if row is None:
        return None
    concept, topic_slug, topic_name, subtopic_slug, subtopic_name, likes, review = row
    return ConceptOut(
        id=concept.id,
        slug=concept.slug,
        title=concept.title,
        summary=concept.summary,
        example=concept.example,
        flashcard=concept.flashcard,
        topic_slug=topic_slug,
        topic_name=topic_name,
        subtopic_slug=subtopic_slug,
        subtopic_name=subtopic_name,
        like_count=likes,
        content_version=concept.content_version,
        review=review,
    )

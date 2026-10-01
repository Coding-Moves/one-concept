from datetime import date

import pytest
from sqlalchemy import text

from app.services import reviews, selection, subtopic_quizzes, weekly_quizzes
from app.services.collections import history_page, saved_page
from app.services.concepts import get_concept_out
from app.services.editorial_revisions import decide_revision, submit_revision
from app.services.state import load_state
from tests import test_publication
from tests.editorial_helpers import identity

draft = test_publication.draft


@pytest.mark.parametrize(
    "decision", ["draft", "pending_review", "rejected", "changes_requested"]
)
async def test_private_revisions_never_escape_learner_reads(
    session, draft, user, decision
):
    slug, cid = draft
    actor, settings = await identity(session)
    rid = await session.scalar(
        text("select id from concept_revisions where concept_id=:id"), {"id": cid}
    )
    if decision != "draft":
        await submit_revision(
            session, rid, actor, settings, "Submitted complete fixture for review."
        )
    if decision in ("rejected", "changes_requested"):
        await decide_revision(
            session,
            rid,
            actor,
            settings,
            decision,
            "This draft must stay out of the learner catalog.",
        )
    # Even stale/privileged imports of interactions must not expose draft titles.
    await session.execute(
        text("""insert into concept_interactions(user_id,concept_id,saved_at,liked_at)
        values (:uid,:cid,now(),now())"""),
        {"uid": user, "cid": cid},
    )
    await session.execute(
        text("""insert into daily_assignments(user_id,concept_id,assigned_for,completed_at)
        values (:uid,:cid,current_date,now())"""),
        {"uid": user, "cid": cid},
    )
    await session.execute(
        text("""insert into daily_reviews(user_id,concept_id,assigned_for)
        values (:uid,:cid,current_date)"""),
        {"uid": user, "cid": cid},
    )
    assert await reviews.existing_review(session, user, date.today()) is None
    assert await get_concept_out(session, user, slug) is None
    assert not (await history_page(session, user, None, 20)).items
    assert not (await saved_page(session, user, None, 20)).items
    state = await load_state(session, user, compact=True)
    assert (
        not state.learned
        and not state.saved
        and not state.likes
        and not state.bookmarks
    )
    assert state.assignment_slug is None
    assert not (
        await session.execute(selection._EXISTING, {"uid": user, "today": date.today()})
    ).all()
    assert not (
        await session.execute(weekly_quizzes._CANDIDATES, {"uid": user, "limit": 20})
    ).all()
    assert not (
        await session.execute(subtopic_quizzes._CANDIDATES, {"concept_ids": [cid]})
    ).all()

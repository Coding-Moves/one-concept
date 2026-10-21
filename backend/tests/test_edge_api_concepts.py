"""Compare candidate concept RPCs with FastAPI behavior on real PostgreSQL."""

import json

import pytest
from sqlalchemy import text

from app.services.concepts import get_concept_out


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_edge_concept_matches_existing_detail_and_hides_drafts(session, user):
    slug = await session.scalar(text("select slug from public.concepts where status='published' limit 1"))
    expected = await get_concept_out(session, user, slug)
    candidate = _json(await session.scalar(
        text("select public.edge_api_concept(:uid, :slug)"), {"uid": user, "slug": slug}
    ))
    assert candidate == expected.model_dump(mode="json")
    assert await session.scalar(
        text("select public.edge_api_concept(:uid, 'missing-concept')"), {"uid": user}
    ) is None


@pytest.mark.asyncio
async def test_edge_interactions_are_idempotent_and_independent(session, user):
    slug = await session.scalar(text("select slug from public.concepts where status='published' limit 1"))
    call = text("select public.edge_api_set_interaction(:uid, :slug, :kind, :on)")
    args = {"uid": user, "slug": slug}
    assert await session.scalar(call, {**args, "kind": "like", "on": True}) is True
    assert await session.scalar(call, {**args, "kind": "like", "on": True}) is True
    assert await session.scalar(call, {**args, "kind": "save", "on": True}) is True
    assert await session.scalar(call, {**args, "kind": "like", "on": False}) is True
    row = (
        await session.execute(text("""
            select ci.liked_at, ci.saved_at from public.concept_interactions ci
            join public.concepts c on c.id = ci.concept_id
            where ci.user_id = :uid and c.slug = :slug
        """), args)
    ).one()
    assert row.liked_at is None
    assert row.saved_at is not None
    assert await session.scalar(
        call, {**args, "slug": "missing-concept", "kind": "save", "on": True}
    ) is False


@pytest.mark.asyncio
async def test_edge_concept_rpc_permissions(session):
    permissions = (
        await session.execute(text("""
            select
              has_function_privilege('authenticated', 'public.edge_api_concept(uuid,text)', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.edge_api_set_interaction(uuid,text,text,boolean)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_concept(uuid,text)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.edge_api_set_interaction(uuid,text,text,boolean)', 'EXECUTE')
        """))
    ).one()
    assert permissions == (False, False, True, True)

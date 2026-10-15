"""Connection pages preserve privacy, ownership, and UUID cursor ordering."""

import json
import uuid

import pytest
from sqlalchemy import text


LIST = text("select public.edge_api_connections(:uid,:kind,:cursor,:limit)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def _account(session):
    account = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,:email)"),
                          {"uid": account, "email": f"{account}@example.invalid"})
    return account


async def _pair(session, actor, peer, pair_id, state, initiator):
    await session.execute(text("""insert into public.connections
      (id, low_user, high_user, initiator, state)
      values (:id, :low, :high, :initiator, :state)"""),
      {"id": pair_id, "low": min(actor, peer), "high": max(actor, peer),
       "initiator": initiator, "state": state})


@pytest.mark.asyncio
async def test_connection_pages_keep_public_choices_and_hide_blocks(session, user):
    named, private = await _account(session), await _account(session)
    first = uuid.UUID("00000000-0000-4000-8000-000000000001")
    second = uuid.UUID("00000000-0000-4000-8000-000000000002")
    await _pair(session, user, named, first, "accepted", user)
    await _pair(session, user, private, second, "accepted", user)
    await session.execute(text("update public.profiles set display_name='Selected name' where id=:uid"),
                          {"uid": named})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": named})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": named})
    await session.execute(text("""update public.profile_sharing set enabled=true, show_name=true
      where user_id=:uid"""), {"uid": named})
    page1 = _json(await session.scalar(LIST, {
        "uid": user, "kind": "accepted", "cursor": None, "limit": 1}))
    assert page1 == {"items": [{"id": str(first), "display_name": "Selected name",
                               "public_path": f"/p/{token}"}], "next_cursor": str(first)}
    page2 = _json(await session.scalar(LIST, {
        "uid": user, "kind": "accepted", "cursor": first, "limit": 1}))
    assert page2 == {"items": [{"id": str(second), "display_name": "Private learner",
                               "public_path": None}], "next_cursor": None}
    await session.execute(text("""insert into public.connection_blocks
      (owner_id,target_id) values (:uid,:peer)"""), {"uid": user, "peer": named})
    remaining = _json(await session.scalar(LIST, {
        "uid": user, "kind": "accepted", "cursor": None, "limit": 25}))
    assert remaining["items"] == page2["items"]
    blocked = _json(await session.scalar(LIST, {
        "uid": user, "kind": "blocked", "cursor": None, "limit": 25}))
    assert len(blocked["items"]) == 1
    assert blocked["items"][0]["display_name"] == "Selected name"
    assert blocked["items"][0]["public_path"] is None
    assert "email" not in json.dumps(blocked)
    assert str(named) not in json.dumps(blocked)


@pytest.mark.asyncio
async def test_connection_lists_separate_incoming_outgoing_and_owner(session, user):
    sender, recipient = await _account(session), await _account(session)
    await _pair(session, user, sender, uuid.uuid4(), "pending", sender)
    await _pair(session, user, recipient, uuid.uuid4(), "pending", user)
    incoming = _json(await session.scalar(LIST, {
        "uid": user, "kind": "incoming", "cursor": None, "limit": 25}))
    outgoing = _json(await session.scalar(LIST, {
        "uid": user, "kind": "outgoing", "cursor": None, "limit": 25}))
    assert len(incoming["items"]) == len(outgoing["items"]) == 1
    assert incoming["items"][0]["id"] != outgoing["items"][0]["id"]
    assert _json(await session.scalar(LIST, {
        "uid": user, "kind": "accepted", "cursor": None, "limit": 25})) == {
        "items": [], "next_cursor": None}
    assert await session.scalar(LIST, {
        "uid": uuid.uuid4(), "kind": "incoming", "cursor": None, "limit": 25}) is None
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated',
        'public.edge_api_connections(uuid,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('service_role',
        'public.edge_api_connections(uuid,text,uuid,integer)', 'EXECUTE')"""))).one()
    assert rights == (False, True)

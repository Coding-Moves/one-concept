"""Anonymous profile data is limited to the owner's selected fields."""

import json
import uuid

import pytest
from sqlalchemy import text


PUBLIC = text("select public.edge_api_public_profile(:token)")


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


@pytest.mark.asyncio
async def test_public_profile_is_hidden_until_enabled_and_filters_each_choice(session, user):
    await session.execute(text("""update public.profiles
      set display_name='Visible name', bio='Private bio', avatar_url='preset:aurora'
      where id=:uid"""), {"uid": user})
    await session.execute(text("""insert into public.user_achievements
      (user_id, achievement_code, earned_on, source)
      values (:uid, 'concept_1', current_date, 'history')"""), {"uid": user})
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": user})
    token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                 {"uid": user})
    assert await session.scalar(PUBLIC, {"token": token}) is None
    await session.execute(text("""update public.profile_sharing
      set enabled=true, achievement_codes=array['concept_1'] where user_id=:uid"""), {"uid": user})
    minimum = _json(await session.scalar(PUBLIC, {"token": token}))
    assert minimum == {"profile": {"achievements": [{
        "name": "First concept",
        "description": "Your first completed concept is the start of a lasting library.",
    }]}, "avatar_key": None, "avatar_owner": None}
    await session.execute(text("""update public.profile_sharing
      set show_name=true, show_bio=true, show_avatar=true,
          show_streak=true, show_learning=true where user_id=:uid"""), {"uid": user})
    selected = _json(await session.scalar(PUBLIC, {"token": token}))
    assert selected["profile"] == {
        "display_name": "Visible name", "bio": "Private bio", "avatar_ref": "preset:aurora",
        "current_streak": 0, "longest_streak": 0, "concepts_learned": 0,
        "achievements": minimum["profile"]["achievements"],
    }
    assert selected["avatar_key"] is selected["avatar_owner"] is None


@pytest.mark.asyncio
async def test_public_avatar_key_is_owner_bound_and_old_token_stays_revoked(session, user):
    await session.scalar(text("select public.edge_api_sharing_get(:uid)"), {"uid": user})
    old_token = await session.scalar(text("select public_token from public.profile_sharing where user_id=:uid"),
                                     {"uid": user})
    own_key = f"avatars/{user}/{'a' * 32}.jpg"
    await session.execute(text("update public.profiles set avatar_url=:key where id=:uid"),
                          {"key": own_key, "uid": user})
    enabled = await session.scalar(text("""select public.edge_api_sharing_put(
      :uid, true, false, true, false, false, false, '{}'::text[], 0)"""), {"uid": user})
    assert _json(enabled)["public_path"] == f"/p/{old_token}"
    visible = _json(await session.scalar(PUBLIC, {"token": old_token}))
    assert visible == {"profile": {"achievements": []},
                       "avatar_key": own_key, "avatar_owner": str(user)}
    await session.execute(text("update public.profiles set avatar_url=:key where id=:uid"),
                          {"key": f"avatars/{uuid.uuid4()}/{'b' * 32}.jpg", "uid": user})
    assert _json(await session.scalar(PUBLIC, {"token": old_token}))["avatar_key"] is None
    await session.scalar(text("""select public.edge_api_sharing_put(
      :uid, false, false, false, false, false, false, '{}'::text[], 1)"""), {"uid": user})
    assert await session.scalar(PUBLIC, {"token": old_token}) is None
    await session.scalar(text("""select public.edge_api_sharing_put(
      :uid, true, false, false, false, false, false, '{}'::text[], 2)"""), {"uid": user})
    assert await session.scalar(PUBLIC, {"token": old_token}) is None


@pytest.mark.asyncio
async def test_public_profile_rejects_malformed_tokens_and_direct_authenticated_execute(session):
    assert await session.scalar(PUBLIC, {"token": "too-short"}) is None
    assert await session.scalar(PUBLIC, {"token": "a" * 43}) is None
    rights = (await session.execute(text("""select
      has_function_privilege('authenticated', 'public.edge_api_public_profile(text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.edge_api_public_profile(text)', 'EXECUTE')"""))).one()
    assert rights == (False, True)

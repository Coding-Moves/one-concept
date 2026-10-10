import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests import test_api

client = test_api.client
anon_client = test_api.anon_client


async def test_private_default_and_selected_public_fields(client, session, user):
    settings = (await client.get('/v1/me/profile-sharing')).json()
    assert settings == dict(enabled=False, show_name=False, show_avatar=False, show_bio=False, show_streak=False,
                            show_learning=False, achievement_codes=[], version=0, public_path=None)
    await session.execute(text('update profiles set display_name=:name where id=:uid'),
                          {'uid': user, 'name': '<script>alert(1)</script>'})
    await session.commit()
    enabled = (await client.put('/v1/me/profile-sharing', json={**{k:v for k,v in settings.items() if k != 'public_path'},
                                'enabled': True})).json()
    path = enabled['public_path']
    token = path.split('/')[-1]
    assert str(user) not in path and len(token) == 43
    response = await client.get('/v1/public-profiles/' + token)
    assert response.json() == {'achievements': []}
    assert 'no-store' in response.headers['cache-control']
    enabled.pop('public_path')
    changed = await client.put('/v1/me/profile-sharing', json={**enabled, 'show_name': True, 'show_learning': True})
    assert changed.status_code == 200
    data = (await client.get('/v1/public-profiles/' + token)).json()
    assert set(data) == {'display_name', 'concepts_learned', 'achievements'}
    assert data['concepts_learned'] == 0
    page = await client.get(path)
    assert '<script>alert' not in page.text
    assert '&lt;script&gt;' in page.text
    assert 'learner@example.invalid' not in page.text and str(user) not in page.text
    assert 'no-store' in page.headers['cache-control']


async def test_revocation_rotation_stale_write_and_owned_achievements(client):
    settings = (await client.get('/v1/me/profile-sharing')).json()
    settings.pop('public_path')
    bad = await client.put('/v1/me/profile-sharing', json={**settings, 'achievement_codes':['concept_100']})
    assert bad.status_code == 422
    result = await client.put('/v1/me/profile-sharing', json={**settings, 'enabled':True, 'show_streak':True})
    assert result.status_code == 200
    state = result.json()
    old_path = state.pop('public_path')
    data = (await client.get('/v1/public-profiles/' + old_path.split('/')[-1])).json()
    assert set(data) == {'achievements', 'current_streak', 'longest_streak'}
    assert (await client.put('/v1/me/profile-sharing', json=settings)).status_code == 409
    off = (await client.put('/v1/me/profile-sharing', json={**state,'enabled':False})).json()
    assert off.pop('public_path') is None
    assert (await client.get(old_path)).status_code == 404
    assert (await client.get('/v1/public-profiles/' + old_path.split('/')[-1])).status_code == 404
    on = (await client.put('/v1/me/profile-sharing', json={**off,'enabled':True})).json()
    assert on['public_path'] != old_path
    assert (await client.get(old_path)).status_code == 404


async def test_bio_is_private_until_selected_and_disappears_when_cleared(client, session, user):
    await session.execute(text('update profiles set bio=:bio where id=:uid'),
                          {'uid': user, 'bio': '<friend> learning every day'})
    await session.commit()
    settings = (await client.get('/v1/me/profile-sharing')).json()
    enabled = (await client.put('/v1/me/profile-sharing', json={**{k: v for k, v in settings.items() if k != 'public_path'},
                                                            'enabled': True})).json()
    token = enabled['public_path'].split('/')[-1]
    assert (await client.get('/v1/public-profiles/' + token)).json() == {'achievements': []}
    assert '<friend>' not in (await client.get(enabled['public_path'])).text

    shared = (await client.put('/v1/me/profile-sharing', json={**{k: v for k, v in enabled.items() if k != 'public_path'},
                                                           'show_bio': True})).json()
    assert shared['show_bio'] is True
    assert (await client.get('/v1/public-profiles/' + token)).json() == {
        'bio': '<friend> learning every day', 'achievements': []}
    page = (await client.get(shared['public_path'])).text
    assert '&lt;friend&gt; learning every day' in page
    assert '<friend>' not in page and 'learner@example.invalid' not in page

    await session.execute(text('update profiles set bio=null where id=:uid'), {'uid': user})
    await session.commit()
    assert (await client.get('/v1/public-profiles/' + token)).json() == {'achievements': []}
    await session.execute(text('update profiles set bio=:bio where id=:uid'), {'uid': user, 'bio': 'Back again'})
    await session.commit()
    hidden = (await client.put('/v1/me/profile-sharing', json={**{k: v for k, v in shared.items() if k != 'public_path'},
                                                           'show_bio': False})).json()
    assert hidden['show_bio'] is False
    assert (await client.get('/v1/public-profiles/' + token)).json() == {'achievements': []}
    assert 'Back again' not in (await client.get(hidden['public_path'])).text


async def test_only_selected_earned_achievements(client, session, user):
    await session.execute(text('''insert into user_achievements(user_id,achievement_code,earned_on,source)
                               values (:uid,'concept_1',current_date,'history'),(:uid,'concept_5',current_date,'history')'''), {'uid':user})
    await session.commit()
    response = await client.put('/v1/me/profile-sharing', json={'enabled':True,'version':0,'achievement_codes':['concept_1']})
    assert response.status_code == 200, response.text
    token = response.json()['public_path'].split('/')[-1]
    public = (await client.get('/v1/public-profiles/'+token)).json()
    assert public == {'achievements':[{'name':'First concept','description':'Your first completed concept is the start of a lasting library.'}]}


async def test_anonymous_cannot_edit_or_enumerate(anon_client):
    assert (await anon_client.get('/v1/me/profile-sharing')).status_code == 401
    assert (await anon_client.put('/v1/me/profile-sharing',json={'version':0})).status_code == 401
    for token in [str(uuid.uuid4()), 'a'*43]:
        response = await anon_client.get('/v1/public-profiles/'+token)
        assert response.status_code == 404
        assert 'no-store' in response.headers['cache-control']


async def test_learner_cannot_access_sharing_table_directly(client, session, user):
    await client.get('/v1/me/profile-sharing')
    await session.execute(text('set local role authenticated'))
    with pytest.raises(DBAPIError):
        await session.execute(text('select * from profile_sharing'))
    await session.rollback()


async def test_sharing_is_scoped_to_verified_account_and_public_reads_are_anonymous(client, session, user):
    from app.deps import CurrentUser, get_current_user
    from app.main import app

    other = uuid.uuid4()
    await session.execute(text("insert into auth.users(id,email) values (:uid,'other@example.invalid')"), {'uid': other})
    await session.commit()
    original = (await client.put('/v1/me/profile-sharing', json={'enabled': True, 'version': 0})).json()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=other, email='other@example.invalid')
    mine = (await client.get(f'/v1/me/profile-sharing?user_id={user}')).json()
    assert mine['enabled'] is False and mine['public_path'] is None
    spoofed = await client.put('/v1/me/profile-sharing', json={'enabled': False, 'version': 1, 'user_id': str(user)})
    assert spoofed.status_code == 422
    await client.put('/v1/me/profile-sharing', json={'enabled': True, 'version': 0})
    app.dependency_overrides.pop(get_current_user)
    # Same HTTP client now has no authentication override or bearer token.
    response = await client.get(original['public_path'])
    assert response.status_code == 200
    assert 'other@example.invalid' not in response.text
    token = original['public_path'].split('/')[-1]
    assert (await client.get('/v1/public-profiles/' + token)).json() == {'achievements': []}


async def test_concurrent_privacy_writes_cannot_overwrite_one_another(client):
    import asyncio

    await client.get('/v1/me/profile-sharing')
    responses = await asyncio.gather(*[
        client.put('/v1/me/profile-sharing', json={'enabled': value, 'version': 0})
        for value in [True, False]
    ])
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert (await client.get('/v1/me/profile-sharing')).json()['version'] == 1

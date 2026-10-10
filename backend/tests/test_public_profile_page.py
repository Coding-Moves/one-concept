from types import SimpleNamespace

from app import public_profile_page
from app.schemas.profile_sharing import PublicAchievement, PublicProfile


def test_card_renders_selected_content_and_escapes_visitor_text():
    profile = PublicProfile(
        display_name='<script>name</script>', bio='<b>bio</b>', avatar_ref='preset:comet',
        current_streak=3, longest_streak=7, concepts_learned=26,
        achievements=[PublicAchievement(name='<award>', description='earned & shared')],
    )
    html, csp = public_profile_page.render_public_page(profile, 'a' * 43)
    assert '<script>' not in html and '<b>bio</b>' not in html
    assert '&lt;script&gt;name&lt;/script&gt;' in html
    assert '&lt;b&gt;bio&lt;/b&gt;' in html
    assert '&lt;award&gt;' in html and 'earned &amp; shared' in html
    assert 'Current streak' in html and 'Concepts learned' in html
    assert 'Open in One Concept to connect' in html
    assert 'img-src' not in csp


def test_unselected_content_is_absent_and_signed_photo_origin_is_narrow(monkeypatch):
    monkeypatch.setattr(public_profile_page, 'get_settings',
                        lambda: SimpleNamespace(supabase_url='https://storage.example.test'))
    profile = PublicProfile(avatar_url='https://storage.example.test/storage/v1/object/sign/profile-avatars/avatars/id.jpg?token=abc')
    html, csp = public_profile_page.render_public_page(profile, 'b' * 43)
    assert 'src="https://storage.example.test/' in html
    assert csp.endswith('img-src https://storage.example.test')
    assert 'Current streak' not in html and 'Achievements' not in html
    assert 'No learning highlights have been shared.' in html
    profile.avatar_url = 'https://attacker.example/photo.jpg'
    html, csp = public_profile_page.render_public_page(profile, 'b' * 43)
    assert '<img' not in html and 'attacker.example' not in html
    assert 'img-src' not in csp

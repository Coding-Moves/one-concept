"""Small, no-script public card built only from the explicit sharing allowlist."""
from html import escape
from urllib.parse import urlsplit

from app.config import get_settings
from app.schemas.profile_sharing import PublicProfile

PRESETS = {'aurora': '✦', 'comet': '✧', 'forest': '❧', 'ocean': '≈', 'sunset': '☼', 'violet': '✿'}
BASE_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
ICONS = {
    'streak': '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22c4.4 0 7-3 7-7 0-3.8-2.4-6.1-3.8-7.2.2 2.8-1 4.1-2.1 4.6C13.5 8 10.8 5.5 8 3c.2 3.7-3 5.5-3 11.7C5 19 7.7 22 12 22Z"/><path d="M12 22c2 0 3.2-1.4 3.2-3.3 0-1.5-1-2.6-2.5-3.8-.1 1.7-1.4 2.2-2.4 2.8-.5.4-1.3 1.1-1.3 2.2 0 1.3 1.1 2.1 3 2.1Z"/></svg>',
    'learning': '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 4.5c3-.8 6-.5 9 1.2 3-1.7 6-2 9-1.2v14c-3-.8-6-.5-9 1.2-3-1.7-6-2-9-1.2Z"/><path d="M12 5.7v14"/></svg>',
    'achievement': '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="9" r="5"/><path d="m8.5 13-2 8L12 18l5.5 3-2-8"/></svg>',
}


def _avatar(profile: PublicProfile) -> tuple[str, str]:
    if profile.avatar_url:
        image = urlsplit(profile.avatar_url)
        storage = urlsplit(get_settings().supabase_url)
        if (image.scheme == storage.scheme and image.netloc == storage.netloc
                and image.path.startswith('/storage/v1/object/sign/profile-avatars/')):
            origin = f'{image.scheme}://{image.netloc}'
            return f'<img class="avatar" src="{escape(profile.avatar_url, quote=True)}" alt="Shared profile photo">', origin
    preset = (profile.avatar_ref or '').removeprefix('preset:')
    return f'<span class="avatar avatar-symbol" aria-label="Profile avatar">{PRESETS.get(preset, "◉")}</span>', ''


def _document(name: str, body: str) -> str:
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>{escape(name)} · One Concept</title><style>
:root{{color-scheme:light dark}}*{{box-sizing:border-box}}body{{margin:0;background:#f5f5fb;color:#202131;font:16px/1.5 system-ui}}
main{{max-width:560px;margin:0 auto;padding:32px 16px 64px;overflow-wrap:anywhere}}.brand{{color:#5045c8;font-size:12px;font-weight:800;letter-spacing:.15em;margin:0 0 22px}}
.card{{background:#fff;border:1px solid #e5e4f2;border-radius:28px;padding:clamp(20px,5vw,36px);box-shadow:0 12px 32px #24234b12}}
.identity{{display:flex;align-items:center;gap:18px;min-width:0}}.avatar{{display:block;width:76px;height:76px;min-width:76px;border-radius:50%;object-fit:cover}}
.avatar-symbol{{background:#ebe8ff;color:#5045c8;text-align:center;font-size:40px;line-height:76px}}h1{{font-size:clamp(24px,6vw,32px);line-height:1.15;margin:0;overflow-wrap:anywhere}}
.bio{{color:#51556c;margin:20px 0 0;white-space:pre-wrap}}.highlights{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:24px}}
.highlight{{display:flex;flex-direction:column;gap:2px;background:#f5f4fc;border-radius:18px;padding:16px}}.highlight strong{{font-size:24px}}.highlight span:last-child{{font-size:13px;color:#575b74}}
.icon{{color:#6556cb;width:24px;height:24px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;flex:none}}.achievements{{margin-top:28px}}h2{{font-size:19px;margin:0 0 12px}}.award-list{{display:grid;gap:10px}}
.award{{display:flex;gap:12px;background:#f5f4fc;border-radius:16px;padding:14px}}.award p{{margin:2px 0 0;color:#575b74;font-size:14px}}.empty{{color:#575b74;margin:24px 0}}
.connect{{display:block;text-align:center;background:#5045c8;color:white;text-decoration:none;font-weight:700;border-radius:16px;padding:15px;margin-top:28px;min-height:52px}}
.connect:focus-visible{{outline:3px solid #1a155e;outline-offset:3px}}footer{{color:#62647a;font-size:13px;margin:18px 0;text-align:center}}
@media(prefers-color-scheme:dark){{body{{background:#0b0d15;color:#ededf5}}.brand,.icon{{color:#aaa2ff}}.card{{background:#181b2b;border-color:#292d43;box-shadow:none}}
.avatar-symbol{{background:#25274d;color:#aaa2ff}}.bio,.highlight span:last-child,.award p,.empty,footer{{color:#b6bad0}}.highlight,.award{{background:#23263c}}.connect{{background:#9991ff;color:#121325}}.connect:focus-visible{{outline-color:white}}}}
</style></head><body><main><p class="brand">ONE CONCEPT</p><div class="card">{body}</div><footer>Shared with One Concept</footer></main></body></html>'''


def render_unavailable_page() -> tuple[str, str]:
    return _document('Profile unavailable', '<h1>Profile unavailable</h1><p>This link is private or no longer available.</p>'), BASE_CSP


def render_public_page(profile: PublicProfile, token: str) -> tuple[str, str]:
    avatar, image_origin = _avatar(profile)
    name = profile.display_name or 'One Concept learner'
    parts = [f'<div class="identity">{avatar}<h1>{escape(name)}</h1></div>']
    if profile.bio:
        parts.append(f'<p class="bio">{escape(profile.bio)}</p>')
    highlights = []
    if profile.current_streak is not None:
        highlights.append(f'<div class="highlight">{ICONS["streak"]}'
                          f'<strong>{profile.current_streak} days</strong><span>Current streak · Best {profile.longest_streak}</span></div>')
    if profile.concepts_learned is not None:
        highlights.append(f'<div class="highlight">{ICONS["learning"]}'
                          f'<strong>{profile.concepts_learned}</strong><span>Concepts learned</span></div>')
    if highlights:
        parts.append('<div class="highlights">' + ''.join(highlights) + '</div>')
    if profile.achievements:
        awards = ''.join(f'<article class="award">{ICONS["achievement"]}'
                         f'<div><strong>{escape(a.name)}</strong><p>{escape(a.description)}</p></div></article>'
                         for a in profile.achievements)
        parts.append(f'<section class="achievements"><h2>Achievements</h2><div class="award-list">{awards}</div></section>')
    if not highlights and not profile.achievements:
        parts.append('<p class="empty">No learning highlights have been shared.</p>')
    # This native link opens the app; Connect is an authenticated action there.
    parts.append(f'<a class="connect" href="com.codingmoves.oneconcept://p/{token}">Open in One Concept to connect <span aria-hidden="true">↗</span></a>')
    csp = BASE_CSP + (f'; img-src {image_origin}' if image_origin else '')
    return _document(name, ''.join(parts)), csp

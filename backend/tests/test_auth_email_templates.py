"""Source templates stay legible when remote images are blocked by email clients."""

from html.parser import HTMLParser
from pathlib import Path
import hashlib


ROOT = Path(__file__).resolve().parents[1] / "email-templates"
REPO = Path(__file__).resolve().parents[2]
LOGO = "https://coding-moves-one-concept-review.netlify.app/one-concept-icon.png"
CODING_MOVES = "https://codingmoves.netlify.app/products/"


class TemplateInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []
        self.links = []
        self.words = []
        self.headings = []
        self._heading = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "img":
            self.images.append(values)
        if tag == "a":
            self.links.append(values.get("href"))
        if tag == "h1":
            self._heading = True

    def handle_endtag(self, tag):
        if tag == "h1":
            self._heading = False

    def handle_data(self, data):
        self.words.append(data)
        if self._heading:
            self.headings.append(data)


def test_auth_templates_use_public_existing_icon_and_readable_wordmark():
    for name in ("confirm-signup", "invite-reviewer", "reset-password", "password-changed"):
        parser = TemplateInspector()
        source = (ROOT / f"{name}.html").read_text(encoding="utf-8")
        parser.feed(source)
        assert len(parser.images) == 1, name
        assert parser.images[0]["src"] == LOGO, name
        assert parser.images[0]["width"] == parser.images[0]["height"] == "48", name
        assert parser.images[0]["alt"] == "One Concept", name
        assert "One Concept" in " ".join(parser.words), name
        assert parser.links.count(CODING_MOVES) == 1, name
        assert 'by <a href="' + CODING_MOVES + '"' in source, name

    icon = (REPO / "mobile/assets/icon.png").read_bytes()
    public_icon = (REPO / "admin/public/one-concept-icon.png").read_bytes()
    assert hashlib.sha256(icon).digest() == hashlib.sha256(public_icon).digest()


def test_action_templates_keep_safely_substituted_confirmation_link_twice():
    for name in ("confirm-signup", "invite-reviewer", "reset-password"):
        parser = TemplateInspector()
        parser.feed((ROOT / f"{name}.html").read_text(encoding="utf-8"))
        assert parser.links.count("{{ .ConfirmationURL }}") == 2, name

    parser = TemplateInspector()
    parser.feed((ROOT / "password-changed.html").read_text(encoding="utf-8"))
    assert "{{ .ConfirmationURL }}" not in parser.links


def test_auth_template_copy_and_visual_tokens_match_each_flow():
    expected = {
        "confirm-signup": ("Confirm your email.", "Confirm email"),
        "reset-password": ("Reset your password.", "Reset password"),
        "invite-reviewer": ("You’re invited to One Concept.", "Accept invitation"),
        "password-changed": ("Your password was changed.", None),
    }
    for name, (heading, action) in expected.items():
        html = (ROOT / f"{name}.html").read_text(encoding="utf-8")
        parser = TemplateInspector()
        parser.feed(html)
        assert "".join(parser.headings) == heading, name
        assert "#171923" in html and "#F3F5FA" in html and "#F8FAFC" in html, name
        assert "#526078" in html and "#E2E8F0" in html, name
        if action is None:
            assert "{{ .ConfirmationURL }}" not in html, name
        else:
            assert action in " ".join(parser.words), name

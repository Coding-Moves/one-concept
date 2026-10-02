"""Template safety and the MIME contract, without a provider connection."""

from email import policy
from email.parser import BytesParser
from types import SimpleNamespace
from uuid import uuid4

from app.services import editorial_mail
from app.services.editorial_email_template import render


def test_email_has_plain_fallback_and_safe_accessible_html():
    origin = "https://review.test.invalid"
    url = f"{origin}/?view=review&kind=revisions&id={uuid4()}"
    body = (
        "You have 1 assigned lesson(s) ready for review.\n\n"
        'Topic: <img src=x onerror="bad()"> & Engineering | Due: 2026-10-04 18:00 PKT\n'
        + url
        + "\n\nSign in with your invited account and authenticator.\n"
    )
    msg = editorial_mail.message(
        SimpleNamespace(
            editorial_email_from="sender@test.invalid",
            editorial_email_dashboard_url=origin,
        ),
        {
            "id": uuid4(),
            "recipient_email": "reviewer@test.invalid",
            "subject": "Review",
            "body": body,
        },
    )
    received = BytesParser(policy=policy.default).parsebytes(msg.as_bytes())
    assert received.get_content_type() == "multipart/alternative"
    assert received.get_body(preferencelist=("plain",)).get_content() == body
    html = received.get_body(preferencelist=("html",)).get_content()
    assert 'lang="en"' in html and "ONE CONCEPT" in html
    assert "<img" not in html and "&lt;img" in html and "&amp; Engineering" in html
    assert "2026-10-04 18:00 PKT" in html
    assert url.replace("&", "&amp;") in html
    assert "Open assigned lesson 1" in html
    assert "authenticator" in html and "<script" not in html


def test_only_exact_revision_links_become_buttons():
    rid = uuid4()
    invalid = [
        "javascript:alert(1)",
        f"https://evil.invalid/?view=review&kind=revisions&id={rid}",
        f"https://review.test.invalid.evil.invalid/?view=review&kind=revisions&id={rid}",
        f"https://review.test.invalid/?view=review&kind=revisions&id={rid}&redirect=evil",
        "https://review.test.invalid/?view=review&kind=revisions&id=invalid",
        "https://[invalid",
    ]
    html = render("\n".join(invalid), "https://review.test.invalid")
    assert "<a " not in html

"""Render the frozen plain-text notice as safe, self-contained HTML email."""

from html import escape
from pathlib import Path
from string import Template
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

_TEMPLATE = Template(
    (
        Path(__file__).resolve().parents[1] / "templates" / "editorial_review.html"
    ).read_text(encoding="utf-8")
)


def review_link(line: str, dashboard_origin: str) -> bool:
    """Only turn our exact dashboard revision links into action buttons."""
    try:
        url = urlsplit(line)
        query = parse_qs(url.query, strict_parsing=True)
        return (
            url.scheme == "https"
            and f"{url.scheme}://{url.netloc}" == dashboard_origin.rstrip("/")
            and url.path == "/"
            and not url.fragment
            and set(query) == {"view", "kind", "id"}
            and query["view"] == ["review"]
            and query["kind"] == ["revisions"]
            and len(query["id"]) == 1
            and str(UUID(query["id"][0])) == query["id"][0]
        )
    except (ValueError, KeyError):
        return False


def render(body: str, dashboard_origin: str) -> str:
    blocks = []
    number = 0
    for line in body.splitlines():
        if not line:
            continue
        safe = escape(line, quote=True)
        if review_link(line, dashboard_origin):
            number += 1
            blocks.append(
                '<p style="margin:12px 0 28px;"><a href="' + safe + '" '
                'style="display:inline-block;background:#5248bf;color:#ffffff;'
                'padding:12px 20px;border-radius:8px;font-weight:bold;text-decoration:none;">'
                f"Open assigned lesson {number}</a></p>"
            )
        else:
            blocks.append('<p style="margin:0 0 12px;">' + safe + "</p>")
    return _TEMPLATE.substitute(content="\n".join(blocks))

"""Authenticated operator client for the same editorial HTTP gates as the UI.

Supply a short-lived MFA access token through EDITORIAL_ACCESS_TOKEN, never an
argument, reviewer name, database credential or service-role key.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--api-url", required=True, help="HTTPS backend origin")
    p.add_argument(
        "--path", required=True, help="/v1/editorial/... endpoint with optional query"
    )
    p.add_argument("--body", type=Path, help="JSON command; omit for a GET")
    return p


async def run(args):
    origin = urlsplit(args.api_url)
    route = urlsplit(args.path)
    if (
        origin.scheme != "https"
        or not origin.hostname
        or origin.username
        or origin.password
        or origin.path not in ("", "/")
        or origin.query
        or origin.fragment
    ):
        raise ValueError("Use an HTTPS backend origin without credentials or a path")
    if (
        route.scheme
        or route.netloc
        or route.fragment
        or not route.path.startswith("/v1/editorial/")
        or ".." in args.path
        or "%" in route.path
        or "\\" in args.path
    ):
        raise ValueError("Choose an editorial API path")
    token = os.environ.get("EDITORIAL_ACCESS_TOKEN", "")
    if not token or any(c.isspace() for c in token):
        raise ValueError("Set EDITORIAL_ACCESS_TOKEN to a current MFA access token")
    body = None
    if args.body is not None:
        with args.body.open("rb") as source:
            data = source.read(65537)
        if len(data) > 65536:
            raise ValueError("Editorial request exceeds 64 KiB")
        body = json.loads(data)
        if not isinstance(body, dict):
            raise ValueError("A command must be a JSON object")
    async with httpx.AsyncClient(
        timeout=30, follow_redirects=False, trust_env=False
    ) as client:
        response = await client.request(
            "POST" if body is not None else "GET",
            args.api_url.rstrip("/") + args.path,
            headers={"Authorization": "Bearer " + token},
            json=body,
        )
    if response.status_code >= 300:
        raise ValueError(
            f"Editorial API returned HTTP {response.status_code}; reload the resource and check permissions"
        )
    return response.json()


def main():
    try:
        print(json.dumps(asyncio.run(run(parser().parse_args())), indent=2))
    except (ValueError, OSError, httpx.HTTPError):
        # Provider exceptions can contain request URLs or credentials. Report
        # no token, response body or transport representation to terminal logs.
        raise SystemExit(
            "Editorial request failed. Check the API origin, current MFA token and command, then retry with the same request_id."
        ) from None


if __name__ == "__main__":
    main()

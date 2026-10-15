"""Verify the protected staging API with a dedicated Auth test account.

Credentials are read from GitHub environment secrets and are never printed.
The state request may create that test user's daily assignment in staging.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request


PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def target(staging: str, production: str) -> str:
    if not PROJECT_REF.fullmatch(staging) or not PROJECT_REF.fullmatch(production):
        raise ValueError("Both project references are required")
    if staging == production or staging != "zhrulokgngjceqgjkcmw":
        raise ValueError("Refusing a production or unreviewed staging project")
    return f"https://{staging}.supabase.co"


def request_json(url: str, *, method: str = "GET", key: str, token: str | None = None,
                 body: dict | None = None) -> object:
    headers = {"apikey": key}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        if response.status != 200:
            raise ValueError(f"Unexpected HTTP {response.status}")
        return json.load(response)


def smoke(base: str, key: str, email: str, password: str) -> None:
    session = request_json(f"{base}/auth/v1/token?grant_type=password", method="POST",
                           key=key, body={"email": email, "password": password})
    if not isinstance(session, dict) or not isinstance(session.get("access_token"), str):
        raise ValueError("Staging sign-in did not return an access token")
    user = session.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("id"), str) or not UUID.fullmatch(user["id"]):
        raise ValueError("Staging sign-in returned no valid user")
    token = session["access_token"]
    api = f"{base}/functions/v1/api"
    state = request_json(f"{api}/v1/me/state?compact=true&reviews=true", key=key, token=token)
    topics = request_json(f"{api}/v1/topics", key=key, token=token)
    stats = request_json(f"{api}/v1/me/stats", key=key, token=token)
    achievements = request_json(f"{api}/v1/me/achievements", key=key, token=token)
    if not isinstance(state, dict) or not isinstance(state.get("followed_topics"), list) \
       or state.get("daily_availability") not in {
           "available", "review_available", "catalog_exhausted", "personalization_required"
       }:
        raise ValueError("Staging state contract is unavailable")
    if state.get("daily") is not None and (
        not isinstance(state["daily"], dict)
        or not isinstance(state["daily"].get("concept"), dict)
        or state.get("assignment_slug") != state["daily"]["concept"].get("slug")
    ):
        raise ValueError("Daily assignment pointer differs from startup card")
    if not isinstance(topics, list) or not isinstance(stats, dict) \
       or not isinstance(achievements, dict) or not isinstance(achievements.get("items"), list):
        raise ValueError("Staging learner API contract is unavailable")
    if state.get("stats") != stats:
        raise ValueError("State and statistics disagree")


def main() -> int:
    try:
        base = target(os.environ["STAGING_PROJECT_REF"], os.environ["PRODUCTION_PROJECT_REF"])
        smoke(base, os.environ["SUPABASE_STAGING_PUBLISHABLE_KEY"],
              os.environ["SUPABASE_STAGING_TEST_EMAIL"],
              os.environ["SUPABASE_STAGING_TEST_PASSWORD"])
    except (KeyError, ValueError, urllib.error.URLError, TimeoutError, OSError) as exc:
        # Never print provider responses, credentials, JWTs, or request URLs.
        print(f"Staging API smoke failed ({type(exc).__name__})", file=sys.stderr)
        return 1
    print("Authenticated staging learner smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

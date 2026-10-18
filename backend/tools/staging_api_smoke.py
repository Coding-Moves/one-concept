"""Verify the protected staging API with a dedicated Auth test account.

Credentials are read from GitHub environment secrets and are never printed.
The state request may create that test user's daily assignment in staging.
"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit


PROJECT_REF = re.compile(r"^[a-z0-9]{20}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


class StagingHTTPError(ValueError):
    """A safe request label and status, without URL, response, or credentials."""

    def __init__(self, step: str, status: int):
        super().__init__(f"{step}: HTTP {status}")


class StagingProbeErrors(ValueError):
    """Only fixed request labels and HTTP statuses from multiple probes."""

    def __init__(self, failures: list[StagingHTTPError]):
        super().__init__(", ".join(str(failure) for failure in failures))


def target(staging: str, production: str) -> str:
    if not PROJECT_REF.fullmatch(staging) or not PROJECT_REF.fullmatch(production):
        raise ValueError("Both project references are required")
    if staging == production or staging != "zhrulokgngjceqgjkcmw":
        raise ValueError("Refusing a production or unreviewed staging project")
    return f"https://{staging}.supabase.co"


def request_json(url: str, *, step: str, method: str = "GET", key: str, token: str | None = None,
                 body: dict | None = None) -> object:
    headers = {"apikey": key}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status != 200:
                raise StagingHTTPError(step, response.status)
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise StagingHTTPError(step, exc.code) from None


def avatar_smoke(base: str, key: str, token: str, user_id: str) -> None:
    """Upload a tiny source photo, inspect its signed JPEG, then remove it."""
    api = f"{base}/functions/v1/api"
    initial = request_json(f"{api}/v1/me/state?compact=true", step="avatar preflight",
                           key=key, token=token)
    if not isinstance(initial, dict) or initial.get("avatar_ref") is not None:
        raise ValueError("Staging avatar test user must start without a photo")
    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
        "AAAADUlEQVQI12P4////fwAJ+wP90YOM8AAAAABJRU5ErkJggg=="
    )
    req = urllib.request.Request(
        f"{api}/v1/me/avatar?compact=true", data=png, method="PUT",
        headers={"apikey": key, "authorization": f"Bearer {token}",
                 "content-type": "image/png"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status != 200:
                raise StagingHTTPError("avatar upload", response.status)
            uploaded = json.load(response)
    except urllib.error.HTTPError as exc:
        raise StagingHTTPError("avatar upload", exc.code) from None
    try:
        if not isinstance(uploaded, dict):
            raise ValueError("Staging avatar upload returned no state")
        ref = uploaded.get("avatar_ref")
        signed = uploaded.get("avatar_url")
        if not isinstance(ref, str) or not re.fullmatch(
            rf"avatars/{user_id}/[a-f0-9]{{32}}[.]jpg", ref
        ):
            raise ValueError("Staging avatar upload returned an invalid private key")
        if not isinstance(signed, str):
            raise ValueError("Staging avatar upload returned no signed URL")
        parsed = urlsplit(signed)
        if parsed.scheme != "https" or parsed.netloc != urlsplit(base).netloc or \
                parsed.path != f"/storage/v1/object/sign/profile-avatars/{ref}" or \
                not parsed.query.startswith("token="):
            raise ValueError("Staging avatar URL escaped its private Storage path")
        with urllib.request.urlopen(signed, timeout=15) as response:
            photo = response.read(262_145)
            if response.status != 200 or response.headers.get_content_type() != "image/jpeg" \
                    or len(photo) > 262_144 or not photo.startswith(b"\xff\xd8"):
                raise ValueError("Staging avatar is not a bounded JPEG")
    finally:
        removed = request_json(f"{api}/v1/me/avatar", method="DELETE",
                               step="avatar removal", key=key, token=token)
        if not isinstance(removed, dict) or removed.get("avatar_ref") is not None:
            raise ValueError("Staging avatar removal did not clear the private key")


def smoke(base: str, key: str, email: str, password: str, *, check_avatar: bool = False) -> None:
    session = request_json(f"{base}/auth/v1/token?grant_type=password", method="POST",
                           step="auth sign-in", key=key,
                           body={"email": email, "password": password})
    if not isinstance(session, dict) or not isinstance(session.get("access_token"), str):
        raise ValueError("Staging sign-in did not return an access token")
    user = session.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("id"), str) or not UUID.fullmatch(user["id"]):
        raise ValueError("Staging sign-in returned no valid user")
    token = session["access_token"]
    api = f"{base}/functions/v1/api"
    probes = (
        ("learner state", f"{api}/v1/me/state?compact=true&reviews=true"),
        ("topics", f"{api}/v1/topics"),
        ("statistics", f"{api}/v1/me/stats"),
        ("achievements", f"{api}/v1/me/achievements"),
    )
    results = {}
    failures = []
    for step, url in probes:
        try:
            results[step] = request_json(url, step=step, key=key, token=token)
        except StagingHTTPError as exc:
            failures.append(exc)
    if failures:
        raise StagingProbeErrors(failures)
    state = results["learner state"]
    topics = results["topics"]
    stats = results["statistics"]
    achievements = results["achievements"]
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
    if check_avatar:
        avatar_smoke(base, key, token, user["id"])


def main() -> int:
    try:
        base = target(os.environ["STAGING_PROJECT_REF"], os.environ["PRODUCTION_PROJECT_REF"])
        smoke(base, os.environ["SUPABASE_STAGING_PUBLISHABLE_KEY"],
              os.environ["SUPABASE_STAGING_TEST_EMAIL"],
              os.environ["SUPABASE_STAGING_TEST_PASSWORD"], check_avatar=True)
    except (StagingHTTPError, StagingProbeErrors) as exc:
        print(f"Staging API smoke failed ({exc})", file=sys.stderr)
        return 1
    except (KeyError, ValueError, urllib.error.URLError, TimeoutError, OSError) as exc:
        # Never print provider responses, credentials, JWTs, or request URLs.
        print(f"Staging API smoke failed ({type(exc).__name__})", file=sys.stderr)
        return 1
    print("Authenticated staging learner smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

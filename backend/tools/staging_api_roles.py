"""One-time protected staging reviewer and owner workflow check.

The owner is bootstrapped only for dedicated staging Auth identities. The owner
then invites the already-existing reviewer through the candidate API, reviews
their name, and the reviewer opens the queue. No identities or tokens are logged.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

if __package__:
    from .apply_staging_migrations import connection_environment
    from .staging_api_smoke import UUID, target
else:
    from apply_staging_migrations import connection_environment
    from staging_api_smoke import UUID, target


class ProbeFailure(ValueError):
    """A fixed label and HTTP status, with no provider response data."""


def api_call(url: str, *, label: str, key: str, token: str | None = None,
             method: str = "GET", body: dict | None = None,
             expected: int | tuple[int, ...] = 200) -> object:
    headers = {"apikey": key}
    if token:
        headers["authorization"] = f"Bearer {token}"
    payload = None
    if body is not None:
        headers["content-type"] = "application/json"
        payload = json.dumps(body).encode()
    request = urllib.request.Request(url, headers=headers, data=payload, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as reply:
            status = reply.status
            result = json.load(reply)
    except urllib.error.HTTPError as exc:
        status = exc.code
        result = None
    allowed = (expected,) if isinstance(expected, int) else expected
    if status not in allowed:
        raise ProbeFailure(f"{label}: HTTP {status}, expected {expected}")
    return result


def sign_in(base: str, key: str, email: str, password: str, label: str) -> tuple[str, str]:
    result = api_call(f"{base}/auth/v1/token?grant_type=password", label=label,
                      key=key, method="POST", body={"email": email, "password": password})
    if not isinstance(result, dict) or not isinstance(result.get("access_token"), str):
        raise ProbeFailure(f"{label}: missing access token")
    user = result.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("id"), str) \
            or not UUID.fullmatch(user["id"]):
        raise ProbeFailure(f"{label}: missing Auth user")
    return result["access_token"], user["id"]


def staging_sql(env: dict[str, str], sql: str, label: str) -> None:
    result = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
                            env=env, capture_output=True, text=True, timeout=20, check=False)
    if result.returncode != 0:
        raise ProbeFailure(f"{label}: staging SQL failed")


def bootstrap_owner(env: dict[str, str], owner_id: str, reviewer_id: str,
                    learner_id: str) -> None:
    if len({owner_id, reviewer_id, learner_id}) != 3 or \
            not all(UUID.fullmatch(value) for value in (owner_id, reviewer_id, learner_id)):
        raise ProbeFailure("Role identities must be three distinct Auth users")
    sql = f"""
begin;
do $$
begin
  if not exists(select 1 from auth.users where id='{owner_id}'::uuid
      and email_confirmed_at is not null) or
     not exists(select 1 from auth.users where id='{reviewer_id}'::uuid
      and email_confirmed_at is not null) then
    raise exception 'Dedicated staging role accounts must be confirmed';
  end if;
  if not exists(select 1 from public.editorial_memberships
      where user_id='{owner_id}'::uuid) then
    insert into public.editorial_memberships
      (user_id, invited_email, capabilities, requested_name, approved_name, require_mfa)
    select id, lower(email),
      array['review','approve','publish','request_generation','manage_reviewers'],
      'Staging Owner', 'Staging Owner', false
    from auth.users where id='{owner_id}'::uuid;
    insert into public.editorial_account_events(actor_id,subject_id,action,details)
    values('{owner_id}'::uuid,'{owner_id}'::uuid,'bootstrap',
      '{{"purpose":"candidate-staging-role-check"}}'::jsonb);
  end if;
  if not exists(select 1 from public.editorial_memberships
      where user_id='{owner_id}'::uuid and status='active'
        and approved_name='Staging Owner' and require_mfa=false
        and capabilities @> array['manage_reviewers','review']::text[]) then
    raise exception 'Staging owner does not match the dedicated test role';
  end if;
end $$;
commit;
"""
    staging_sql(env, sql, "owner bootstrap")


def relax_reviewer_mfa(env: dict[str, str], reviewer_id: str) -> None:
    if not UUID.fullmatch(reviewer_id):
        raise ProbeFailure("Invalid staging reviewer identity")
    sql = f"""
begin;
do $$
begin
  if not exists(select 1 from public.editorial_memberships
      where user_id='{reviewer_id}'::uuid and status='active'
        and approved_name='Staging Reviewer'
        and capabilities @> array['review']::text[]) then
    raise exception 'Dedicated reviewer is not approved';
  end if;
  if exists(select 1 from public.editorial_memberships
      where user_id='{reviewer_id}'::uuid and require_mfa=true) then
    update public.editorial_memberships set require_mfa=false,
      version=version+1, updated_at=now()
      where user_id='{reviewer_id}'::uuid;
    insert into public.editorial_account_events(actor_id,subject_id,action,details)
    values('{reviewer_id}'::uuid,'{reviewer_id}'::uuid,'authenticator_choice',
      '{{"require_mfa":false,"purpose":"candidate-staging-role-check"}}'::jsonb);
  end if;
end $$;
commit;
"""
    staging_sql(env, sql, "reviewer MFA test setup")


def run() -> int:
    try:
        staging_ref = os.environ["STAGING_PROJECT_REF"]
        production_ref = os.environ["PRODUCTION_PROJECT_REF"]
        base = target(staging_ref, production_ref)
        env = connection_environment(staging_ref, production_ref,
                                     os.environ["STAGING_DIRECT_URL"])
        key = os.environ["SUPABASE_STAGING_PUBLISHABLE_KEY"]
        learner_token, learner_id = sign_in(base, key,
            os.environ["SUPABASE_STAGING_TEST_EMAIL"],
            os.environ["SUPABASE_STAGING_TEST_PASSWORD"], "learner sign-in")
        reviewer_token, reviewer_id = sign_in(base, key,
            os.environ["SUPABASE_STAGING_REVIEWER_EMAIL"],
            os.environ["SUPABASE_STAGING_REVIEWER_PASSWORD"], "reviewer sign-in")
        owner_token, owner_id = sign_in(base, key,
            os.environ["SUPABASE_STAGING_OWNER_EMAIL"],
            os.environ["SUPABASE_STAGING_OWNER_PASSWORD"], "owner sign-in")
        editorial = f"{base}/functions/v1/api/v1/editorial"
        api_call(f"{editorial}/me", label="anonymous editorial", key=key, expected=401)
        # Fail before any SQL write if the staging Edge config is still disabled.
        api_call(f"{editorial}/me", label="staging editorial availability",
                 key=key, token=owner_token, expected=(200, 403))
        bootstrap_owner(env, owner_id, reviewer_id, learner_id)
        owner = api_call(f"{editorial}/me", label="owner profile", key=key,
                         token=owner_token)
        if not isinstance(owner, dict) or owner.get("onboarding_required") is not False:
            raise ProbeFailure("Owner profile is not ready")
        reviewer_email = os.environ["SUPABASE_STAGING_REVIEWER_EMAIL"].strip().lower()
        reviewer = api_call(f"{editorial}/me", label="reviewer onboarding",
                            key=key, token=reviewer_token, expected=(200, 403))
        if reviewer is None:
            invitation = api_call(f"{editorial}/reviewers", label="owner invite",
                                  key=key, token=owner_token, method="POST", expected=201,
                                  body={"email": reviewer_email, "capabilities": ["review"]})
            if not isinstance(invitation, dict) or invitation.get("user_id") != reviewer_id:
                raise ProbeFailure("Owner invite returned the wrong reviewer")
            reviewer = api_call(f"{editorial}/me", label="reviewer onboarding",
                                key=key, token=reviewer_token)
        if not isinstance(reviewer, dict) or not isinstance(reviewer.get("member"), dict):
            raise ProbeFailure("Reviewer membership is unavailable")
        member = reviewer["member"]
        capabilities = member.get("capabilities")
        if member.get("user_id") != reviewer_id or not isinstance(capabilities, list) \
                or "review" not in capabilities or not isinstance(member.get("version"), int):
            raise ProbeFailure("Reviewer membership differs from the test role")
        if member.get("requested_name") is None:
            requested = api_call(f"{editorial}/me/profile", label="reviewer name request",
                                 key=key, token=reviewer_token, method="PATCH",
                                 body={"expected_version": member["version"],
                                       "registered_name": "Staging Reviewer"})
            if not isinstance(requested, dict) or requested.get("requested_name") != "Staging Reviewer":
                raise ProbeFailure("Reviewer name request failed")
            member = requested
        if member.get("requested_name") != "Staging Reviewer":
            raise ProbeFailure("Reviewer name differs from the test setup")
        if member.get("approved_name") != "Staging Reviewer":
            approved = api_call(f"{editorial}/reviewers/{reviewer_id}/approve-profile",
                                label="owner name approval", key=key, token=owner_token,
                                method="POST", body={"expected_version": member["version"]})
            if not isinstance(approved, dict) or approved.get("approved_name") != "Staging Reviewer":
                raise ProbeFailure("Owner name approval failed")
            member = approved
        if member.get("require_mfa") is True:
            api_call(f"{editorial}/queue", label="reviewer MFA gate", key=key,
                     token=reviewer_token, expected=403)
            relax_reviewer_mfa(env, reviewer_id)
        queue = api_call(f"{editorial}/queue", label="reviewer queue", key=key,
                         token=reviewer_token)
        if not isinstance(queue, dict) or not isinstance(queue.get("items"), list):
            raise ProbeFailure("Reviewer queue contract failed")
        api_call(f"{editorial}/owner/overview", label="owner overview", key=key,
                 token=owner_token)
        api_call(f"{editorial}/owner/overview", label="reviewer owner isolation",
                 key=key, token=reviewer_token, expected=403)
        api_call(f"{editorial}/me", label="learner editorial isolation",
                 key=key, token=learner_token, expected=403)
        print("Staging owner invite, reviewer onboarding, MFA denial, role isolation, and queue passed")
        return 0
    except (KeyError, ProbeFailure, ValueError, urllib.error.URLError,
            subprocess.TimeoutExpired, TimeoutError, OSError) as exc:
        # Never echo provider bodies, credentials, user identities, or SQL text.
        if isinstance(exc, ProbeFailure):
            print(f"Staging role probe failed ({exc})", file=sys.stderr)
        else:
            print(f"Staging role probe failed ({type(exc).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(run())

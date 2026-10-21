"""Temporarily configure one staging worker for controlled provider canaries.

Values arrive as protected GitHub environment secrets and never appear in the
command line, repository, or logs. Cleanup removes the provider credentials.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from .apply_staging_migrations import DEMO_PROJECT_REF, PROJECT_REF
except ImportError:
    from apply_staging_migrations import DEMO_PROJECT_REF, PROJECT_REF


PRIVATE = {
    "WORKER_PUSH_TEST_TOKENS": "STAGING_CANARY_PUSH_TOKEN",
    "EDITORIAL_EMAIL_TEST_RECIPIENTS": "STAGING_CANARY_REVIEWER_EMAIL",
    "EDITORIAL_EMAIL_FROM": "STAGING_CANARY_GMAIL_FROM",
    "EDITORIAL_GMAIL_CLIENT_ID": "STAGING_CANARY_GMAIL_CLIENT_ID",
    "EDITORIAL_GMAIL_CLIENT_SECRET": "STAGING_CANARY_GMAIL_CLIENT_SECRET",
    "EDITORIAL_GMAIL_REFRESH_TOKEN": "STAGING_CANARY_GMAIL_REFRESH_TOKEN",
    "GEMINI_API_KEY": "STAGING_CANARY_GEMINI_KEY",
}
FLAGS = {
    "EDITORIAL_ENABLED": "true",
    "EDITORIAL_EMAIL_ENABLED": "true",
    "WEEKLY_QUIZ_NOTIFICATIONS_ENABLED": "true",
    "GENERATION_ENABLED": "true",
    "WORKER_GENERATION_TEST_ENABLED": "true",
    "FUTURE_REFILL_ENABLED": "false",
    "LEGACY_ENRICHMENT_ENABLED": "false",
    "GENERATION_DAILY_CALL_CAP": "1",
    "GENERATION_MAX_CONCURRENT": "1",
    "EDITORIAL_EMAIL_DAILY_CAP": "1",
    "EDITORIAL_EMAIL_DASHBOARD_URL": "https://review.example.test",
    "ALLOWED_ORIGINS": "https://review.example.test",
}
EMAIL_PRIVATE = {name: source for name, source in PRIVATE.items()
                 if name in {"EDITORIAL_EMAIL_TEST_RECIPIENTS", "EDITORIAL_EMAIL_FROM",
                             "EDITORIAL_GMAIL_CLIENT_ID", "EDITORIAL_GMAIL_CLIENT_SECRET",
                             "EDITORIAL_GMAIL_REFRESH_TOKEN"}}
EMAIL_FLAGS = {name: value for name, value in FLAGS.items()
               if name in {"EDITORIAL_ENABLED", "EDITORIAL_EMAIL_ENABLED",
                           "EDITORIAL_EMAIL_DASHBOARD_URL", "ALLOWED_ORIGINS"}}
EMAIL_FLAGS["EDITORIAL_EMAIL_DAILY_CAP"] = "3"


def target_is_safe() -> bool:
    staging = os.environ.get("STAGING_PROJECT_REF", "")
    production = os.environ.get("PRODUCTION_PROJECT_REF", "")
    return staging == DEMO_PROJECT_REF and bool(PROJECT_REF.fullmatch(production)) \
        and staging != production


def set_values(values: dict[str, str]) -> int:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", prefix="worker-canary-", delete=False) as file:
            temporary = Path(file.name)
            os.chmod(temporary, 0o600)
            for name, value in values.items():
                file.write(f"{name}={value}\n")
        result = subprocess.run(["supabase", "secrets", "set", "--env-file",
                                 str(temporary), "--project-ref",
                                 os.environ["STAGING_PROJECT_REF"]],
                                capture_output=True, text=True, check=False, timeout=90)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    if result.returncode:
        print("Staging canary provider setup failed", file=sys.stderr)
        return 1
    return 0


def configure() -> int:
    if not target_is_safe():
        print("Canary secret setup refused: unreviewed target", file=sys.stderr)
        return 2
    inputs = {name: os.environ.get(source, "") for name, source in PRIVATE.items()}
    for name in ("WORKER_PUSH_TEST_TOKENS", "EDITORIAL_EMAIL_TEST_RECIPIENTS",
                 "EDITORIAL_EMAIL_FROM"):
        inputs[name] = inputs[name].strip()
    if any(not value or any(char in value for char in "\x00\r\n")
           for value in inputs.values()) or \
       not re.fullmatch(r"(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,160}\]",
                        inputs["WORKER_PUSH_TEST_TOKENS"]) or \
       not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",
                        inputs["EDITORIAL_EMAIL_TEST_RECIPIENTS"]) or \
       not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",
                        inputs["EDITORIAL_EMAIL_FROM"]):
        print("Canary provider inputs are missing or invalid", file=sys.stderr)
        return 2
    values = {f"WORKER_CANARY_{name}": value
              for name, value in (inputs | FLAGS).items()}
    if set_values(values):
        return 1
    print("Staging worker provider canaries configured")
    return 0


def configure_email() -> int:
    if not target_is_safe():
        print("Email retry secret setup refused: unreviewed target", file=sys.stderr)
        return 2
    inputs = {name: os.environ.get(source, "").strip()
              if name in {"EDITORIAL_EMAIL_TEST_RECIPIENTS", "EDITORIAL_EMAIL_FROM"}
              else os.environ.get(source, "")
              for name, source in EMAIL_PRIVATE.items()}
    if any(not value or any(char in value for char in "\x00\r\n")
           for value in inputs.values()) or any(
               not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", inputs[name])
               for name in ("EDITORIAL_EMAIL_TEST_RECIPIENTS", "EDITORIAL_EMAIL_FROM")
           ):
        print("Email retry provider inputs are missing or invalid", file=sys.stderr)
        return 2
    values = {f"WORKER_CANARY_{name}": value
              for name, value in (inputs | EMAIL_FLAGS).items()}
    if set_values(values):
        return 1
    print("Staging email retry provider settings configured")
    return 0


def cleanup() -> int:
    if not target_is_safe():
        print("Canary secret cleanup refused: unreviewed target", file=sys.stderr)
        return 2
    # Clear switches first, even if removing credentials later fails.
    switches = ["WORKER_CANARY_WORKER_GENERATION_TEST_ENABLED=false",
                "WORKER_CANARY_GENERATION_ENABLED=false",
                "WORKER_CANARY_EDITORIAL_EMAIL_ENABLED=false",
                "WORKER_CANARY_WEEKLY_QUIZ_NOTIFICATIONS_ENABLED=false"]
    result = subprocess.run(["supabase", "secrets", "set", *switches,
                             "--project-ref", os.environ["STAGING_PROJECT_REF"]],
                            capture_output=True, text=True, check=False, timeout=90)
    if result.returncode:
        print("Could not disable staging provider switches", file=sys.stderr)
        return 1
    listed = subprocess.run(["supabase", "secrets", "list", "--project-ref",
                             os.environ["STAGING_PROJECT_REF"], "--output", "json"],
                            capture_output=True, text=True, check=False, timeout=90)
    if listed.returncode:
        print("Could not inspect staging provider secret names", file=sys.stderr)
        return 1
    try:
        present = {item["name"] for item in json.loads(listed.stdout)}
    except (KeyError, TypeError, ValueError):
        print("Could not parse staging provider secret names", file=sys.stderr)
        return 1
    names = [f"WORKER_CANARY_{name}" for name in (PRIVATE | FLAGS)
             if f"WORKER_CANARY_{name}" in present]
    if not names:
        print("Staging provider switches disabled; no temporary credentials remain")
        return 0
    result = subprocess.run(["supabase", "secrets", "unset", *names,
                             "--project-ref", os.environ["STAGING_PROJECT_REF"]],
                            capture_output=True, text=True, check=False, timeout=90)
    if result.returncode:
        print("Could not remove staging provider credentials", file=sys.stderr)
        return 1
    print("Staging provider switches disabled and credentials removed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("configure", "configure-email", "cleanup"))
    args = parser.parse_args()
    if args.mode == "configure":
        return configure()
    if args.mode == "configure-email":
        return configure_email()
    return cleanup()


if __name__ == "__main__":
    raise SystemExit(main())

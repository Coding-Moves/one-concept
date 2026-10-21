"""Attempt all four independent provider canaries within one approved run."""

import subprocess
import sys

try:
    from .run_staging_worker_canary import run
except ImportError:
    from run_staging_worker_canary import run


def main() -> int:
    failed = False
    for job in ("daily_reminders", "weekly_quiz", "editorial_email",
                "editorial_generation"):
        try:
            failed = run(job) != 0 or failed
        except (OSError, subprocess.TimeoutExpired):
            print(f"Staging {job} canary raised a safe execution error", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

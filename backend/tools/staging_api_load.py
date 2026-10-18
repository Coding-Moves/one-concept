"""Bounded staging-only read probe for the 500 daily-user planning assumption.

The single staging identity and its existing daily assignment are reused. This
measures one 500-request burst, not 500 distinct users or a Free-tier guarantee.
Only aggregate timings, sizes, and connection counts are printed.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from math import ceil
import os
import subprocess
import sys
from threading import Event, Thread
from time import monotonic
import urllib.error
import urllib.request

if __package__:
    from .apply_staging_migrations import connection_environment
    from .staging_api_smoke import request_json, target
else:
    from apply_staging_migrations import connection_environment
    from staging_api_smoke import request_json, target


REQUESTS = 500
# One test account shares one serialized request-budget row. Keep this probe
# below the concurrency used for the earlier, unthrottled state-read baseline.
WORKERS = 5
MAX_RESPONSE_BYTES = 1_048_576


class ProbeFailure(ValueError):
    """A fixed, non-sensitive diagnostic for the protected staging log."""


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        raise ValueError("No successful requests")
    ordered = sorted(values)
    return ordered[ceil(fraction * len(ordered)) - 1]


def connection_count(env: dict[str, str]) -> int:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c",
         "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"],
        env=env, capture_output=True, text=True, timeout=15, check=False,
    )
    if result.returncode != 0 or not result.stdout.strip().isdigit():
        raise ValueError("Staging connection sample failed")
    return int(result.stdout.strip())


def sample_connections(env: dict[str, str], stop: Event, samples: list[int],
                       failures: list[Exception]) -> None:
    while not stop.is_set():
        try:
            samples.append(connection_count(env))
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            failures.append(exc)
            return
        stop.wait(1)


def fetch_state(url: str, key: str, token: str) -> tuple[float, int, int]:
    request = urllib.request.Request(
        url, headers={"apikey": key, "authorization": f"Bearer {token}"},
    )
    start = monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            elapsed_ms = (monotonic() - start) * 1000
            if response.status != 200 or "application/json" not in response.headers.get("content-type", ""):
                raise ProbeFailure("state_response")
    except urllib.error.HTTPError as exc:
        if exc.code != 429:
            raise ProbeFailure(f"http_{exc.code}") from None
        body = exc.read(MAX_RESPONSE_BYTES + 1)
        elapsed_ms = (monotonic() - start) * 1000
        retry = exc.headers.get("retry-after", "")
        try:
            detail = json.loads(body)["detail"]
        except (ValueError, KeyError, TypeError):
            raise ProbeFailure("rate_limit_json") from None
        if not retry.isdigit() or not isinstance(detail, dict) or \
                detail.get("code") != "rate_limited" or \
                detail.get("retry_after_seconds") != int(retry):
            raise ProbeFailure("rate_limit_contract")
        if len(body) > MAX_RESPONSE_BYTES:
            raise ProbeFailure("rate_limit_size")
        return elapsed_ms, len(body), 429
    if len(body) > MAX_RESPONSE_BYTES:
        raise ProbeFailure("state_size")
    return elapsed_ms, len(body), 200


def run() -> int:
    try:
        staging_ref = os.environ["STAGING_PROJECT_REF"]
        base = target(staging_ref, os.environ["PRODUCTION_PROJECT_REF"])
        env = connection_environment(
            staging_ref, os.environ["PRODUCTION_PROJECT_REF"],
            os.environ["STAGING_DIRECT_URL"],
        )
        key = os.environ["SUPABASE_STAGING_PUBLISHABLE_KEY"]
        session = request_json(
            f"{base}/auth/v1/token?grant_type=password", step="auth sign-in",
            method="POST", key=key,
            body={"email": os.environ["SUPABASE_STAGING_TEST_EMAIL"],
                  "password": os.environ["SUPABASE_STAGING_TEST_PASSWORD"]},
        )
        if not isinstance(session, dict) or not isinstance(session.get("access_token"), str):
            raise ValueError("Staging sign-in failed")
        token = session["access_token"]
        url = f"{base}/functions/v1/api/v1/me/state?compact=true"
        # Warm the assignment and HTTP path before timing the read burst.
        if fetch_state(url, key, token)[2] != 200:
            raise ProbeFailure("warm_request_limited")
        baseline = connection_count(env)
        samples: list[int] = []
        sample_failures: list[Exception] = []
        stop = Event()
        sampler = Thread(target=sample_connections,
                         args=(env, stop, samples, sample_failures), daemon=True)
        sampler.start()
        timings: list[float] = []
        sizes: list[int] = []
        limited = 0
        started = monotonic()
        pool = ThreadPoolExecutor(max_workers=WORKERS)
        try:
            futures = [pool.submit(fetch_state, url, key, token) for _ in range(REQUESTS)]
            for future in as_completed(futures):
                elapsed_ms, size, status = future.result()
                if status == 429:
                    limited += 1
                else:
                    timings.append(elapsed_ms)
                    sizes.append(size)
            duration_s = monotonic() - started
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
            stop.set()
            sampler.join(timeout=16)
        if sample_failures or not samples:
            raise ProbeFailure("connection_sampling")
        if not timings:
            raise ProbeFailure("all_requests_limited")
        if not limited:
            raise ProbeFailure("no_rate_limit_observed")
        if len(timings) + limited != REQUESTS:
            raise ProbeFailure("request_count")
        ending = connection_count(env)
        print(
            f"Staging state read burst: {REQUESTS} requests, {len(timings)} HTTP 200, "
            f"{limited} HTTP 429, {WORKERS} workers, {duration_s:.1f}s; "
            f"successful latency p50={percentile(timings, .50):.0f}ms "
            f"p95={percentile(timings, .95):.0f}ms; response "
            f"median={percentile(sizes, .50):.0f}B max={max(sizes)}B; "
            f"database connections baseline={baseline} sampled_peak={max(samples)} end={ending}"
        )
        return 0
    except (KeyError, ValueError, urllib.error.URLError, TimeoutError,
            subprocess.TimeoutExpired, OSError) as exc:
        # Error strings from providers, psql, and network libraries may contain
        # credentials or URLs. Print only a fixed diagnostic class.
        reason = exc.args[0] if isinstance(exc, ProbeFailure) else type(exc).__name__
        print(f"Staging load probe failed ({reason})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(run())

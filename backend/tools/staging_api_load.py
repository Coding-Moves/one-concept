"""Bounded staging-only read probe for the 500 daily-user planning assumption.

The single staging identity and its existing daily assignment are reused. This
measures one 500-request burst, not 500 distinct users or a Free-tier guarantee.
Only aggregate timings, sizes, and connection counts are printed.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
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
WORKERS = 10
MAX_RESPONSE_BYTES = 1_048_576


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


def fetch_state(url: str, key: str, token: str) -> tuple[float, int]:
    request = urllib.request.Request(
        url, headers={"apikey": key, "authorization": f"Bearer {token}"},
    )
    start = monotonic()
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            elapsed_ms = (monotonic() - start) * 1000
            if response.status != 200 or "application/json" not in response.headers.get("content-type", ""):
                raise ValueError("Staging state returned an unexpected response")
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Staging state returned HTTP {exc.code}") from None
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("Staging state exceeded the response bound")
    return elapsed_ms, len(body)


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
        fetch_state(url, key, token)
        baseline = connection_count(env)
        samples: list[int] = []
        sample_failures: list[Exception] = []
        stop = Event()
        sampler = Thread(target=sample_connections,
                         args=(env, stop, samples, sample_failures), daemon=True)
        sampler.start()
        timings: list[float] = []
        sizes: list[int] = []
        started = monotonic()
        pool = ThreadPoolExecutor(max_workers=WORKERS)
        try:
            futures = [pool.submit(fetch_state, url, key, token) for _ in range(REQUESTS)]
            for future in as_completed(futures):
                elapsed_ms, size = future.result()
                timings.append(elapsed_ms)
                sizes.append(size)
            duration_s = monotonic() - started
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
            stop.set()
            sampler.join(timeout=16)
        if sample_failures or not samples:
            raise ValueError("Staging connection sampling failed")
        ending = connection_count(env)
        print(
            f"Staging state read burst: {REQUESTS} requests, {WORKERS} workers, "
            f"{duration_s:.1f}s; latency p50={percentile(timings, .50):.0f}ms "
            f"p95={percentile(timings, .95):.0f}ms; response "
            f"median={percentile(sizes, .50):.0f}B max={max(sizes)}B; "
            f"database connections baseline={baseline} sampled_peak={max(samples)} end={ending}"
        )
        return 0
    except (KeyError, ValueError, urllib.error.URLError, TimeoutError,
            subprocess.TimeoutExpired, OSError) as exc:
        # Error strings from providers, psql, and network libraries may contain
        # credentials or URLs. Print only a fixed diagnostic class.
        print(f"Staging load probe failed ({type(exc).__name__})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(run())

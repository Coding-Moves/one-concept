"""Bounded, process-local token buckets for verified accounts.

The deployment runs one Uvicorn process. A restart resets these soft limits;
generation's durable database budget remains the hard provider-spend boundary.
Do not add replicas/workers without replacing this with a shared limiter.
"""

import math
import time
from collections import OrderedDict
from dataclasses import dataclass


@dataclass
class Bucket:
    tokens: float
    updated: float


class AccountRateLimiter:
    def __init__(self, reads: int, writes: int, capacity: int, clock=time.monotonic):
        self.limits = {"read": reads, "write": writes}
        self.capacity = capacity
        self.clock = clock
        self.buckets: OrderedDict[tuple[str, str], Bucket] = OrderedDict()

    def retry_after(self, subject: str, method: str) -> int:
        """Return zero when admitted, or whole seconds to wait. No await/race."""
        now = self.clock()
        # Entries untouched for a minute would be fully refilled anyway.
        while self.buckets:
            oldest = next(iter(self.buckets.values()))
            if now - oldest.updated < 60:
                break
            self.buckets.popitem(last=False)
        kind = "read" if method in {"GET", "HEAD", "OPTIONS"} else "write"
        limit = self.limits[kind]
        key = (subject, kind)
        bucket = self.buckets.get(key)
        if bucket is None:
            # Never evict an active bucket: rotating identities cannot reset it.
            if len(self.buckets) >= self.capacity:
                return 60
            bucket = Bucket(float(limit), now)
            self.buckets[key] = bucket
        bucket.tokens = min(limit, bucket.tokens + (now - bucket.updated) * limit / 60)
        bucket.updated = now
        self.buckets.move_to_end(key)
        if bucket.tokens < 1:
            return max(1, math.ceil((1 - bucket.tokens) * 60 / limit))
        bucket.tokens -= 1
        return 0

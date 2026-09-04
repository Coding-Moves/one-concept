"""Low-watermark prefetch: keep a topic's shelf stocked without ever calling
Gemini on the request path.

When a user nears the end of a topic's published concepts, the daily endpoint
asks this module to top that topic up. Generation then runs as a fire-and-forget
task on the event loop, so the HTTP response returns immediately instead of
waiting seconds for a synchronous generation (issue #43). The catalog is shared,
so the lessons a prefetch writes serve every user — not just the one whose
request triggered it.
"""

import asyncio
import logging
import uuid

from sqlalchemy import text

from app.config import get_settings
from app.db.session import SessionLocal
from app.services.generation import RateLimitedError
from app.services.pool import generate_one

log = logging.getLogger(__name__)

_PUBLISHED_IN_TOPIC = text("""
    select count(*)::int
      from public.concepts
     where topic_id = :topic_id and status = 'published'
""")

# Start topping a topic up once a user's unread published concepts in it fall to
# this many; a run generates until the topic reaches TARGET_PUBLISHED, capped by
# PREFETCH_BATCH lessons so one trigger can't run away.
LOW_WATERMARK = 5
PREFETCH_BATCH = 5
TARGET_PUBLISHED = LOW_WATERMARK + PREFETCH_BATCH

# Topics with a prefetch in flight *in this process*, so a burst of requests for
# the same topic spawns one job rather than one per request. Across processes,
# generate_one's `FOR UPDATE SKIP LOCKED` claim still stops two workers writing
# the same backlog title, so the shared catalog cannot gain duplicates.
_inflight: set[uuid.UUID] = set()
# Strong references to running tasks: asyncio only holds weak ones, so without
# this a fire-and-forget task can be garbage-collected mid-flight.
_tasks: set[asyncio.Task] = set()


def request_prefetch(topic_id: uuid.UUID) -> None:
    """Schedule a background top-up for ``topic_id`` unless one is already running.

    Returns immediately and is never awaited by the request handler, so it adds
    no latency to the response.
    """
    settings = get_settings()
    if not (
        settings.generation_on_demand
        and settings.generation_enabled
        and settings.gemini_api_key
    ):
        return
    if topic_id in _inflight:
        return
    _inflight.add(topic_id)
    task = asyncio.create_task(_run(topic_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _run(topic_id: uuid.UUID) -> None:
    settings = get_settings()
    generated = 0
    try:
        # Its own session: the request's session is closed the moment the
        # response returns, long before this finishes.
        async with SessionLocal() as session:
            for _ in range(PREFETCH_BATCH):
                # Re-check against a shared target each iteration so a prefetch
                # in another process (its lessons land in the same catalog) can
                # satisfy the topic and let this one stop early — bounding the
                # overshoot when several instances trigger at once.
                published = await session.scalar(
                    _PUBLISHED_IN_TOPIC, {"topic_id": topic_id}
                )
                if published is not None and published >= TARGET_PUBLISHED:
                    break
                try:
                    concept_id = await generate_one(
                        session, settings.gemini_api_key, settings.gemini_model, topic_id
                    )
                except RateLimitedError:
                    log.info("prefetch for topic %s stopped: rate limited", topic_id)
                    break
                if concept_id is None:
                    # The topic's backlog is empty or a generation failed —
                    # either way stop rather than spin on the same outcome.
                    break
                generated += 1
    except Exception:
        # A background task must never take the event loop down with it.
        log.exception("prefetch for topic %s failed", topic_id)
    finally:
        _inflight.discard(topic_id)
        if generated:
            log.info("prefetch for topic %s generated %s lessons", topic_id, generated)

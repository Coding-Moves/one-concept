"""Generation: prompt validation, claiming, failure handling, and caps.

Gemini itself is never called here — a stubbed transport stands in, so these
tests are deterministic, free, and exercise the failure paths a live key would
only produce by accident.
"""

import json
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import text

from app.services import generation, pool, selection
from app.services.generation import GenerationError, RateLimitedError, build_prompt, generate_concept, validate
from app.services.interactions import set_followed_topics
from app.services.pool import generate_one, top_up
from app.services.selection import get_or_create_daily

GOOD_SUMMARY = (
    "A write-ahead log records an intended change to durable storage before the "
    "change itself is applied, so a crash midway through leaves a record the "
    "database can replay. It is what lets a system promise durability without "
    "flushing every page to disk on every commit, and it underpins crash "
    "recovery in PostgreSQL, SQLite, and most modern storage engines."
)
GOOD_EXAMPLE = (
    "After an unclean shutdown PostgreSQL replays its WAL from the last "
    "checkpoint, reapplying committed transactions and discarding partial ones."
)


def _stub_transport(payload=None, status=200, body_text=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if body_text is not None:
            return httpx.Response(status, text=body_text)
        return httpx.Response(status, json=payload)

    return httpx.MockTransport(handler)


def _gemini_response(summary, example):
    return {
        "candidates": [
            {"content": {"parts": [{"text": json.dumps({"summary": summary, "example": example})}]}}
        ]
    }


@pytest.fixture
def patch_httpx(monkeypatch):
    def use(transport):
        original = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs["transport"] = transport
            return original(*args, **kwargs)

        monkeypatch.setattr(generation.httpx, "AsyncClient", factory)

    return use


# ---------------------------------------------------------------- prompt

def test_prompt_carries_title_topic_and_angle():
    prompt = build_prompt("Write-Ahead Logging", "Software Engineering", "crash recovery")
    assert "Write-Ahead Logging" in prompt
    assert "Software Engineering" in prompt
    assert "crash recovery" in prompt
    # Few-shot examples define the house voice.
    assert "Idempotency" in prompt and "File Descriptors" in prompt


# ---------------------------------------------------------------- validation

def test_validation_accepts_good_output():
    summary, example = validate({"summary": GOOD_SUMMARY, "example": GOOD_EXAMPLE}, "x")
    assert summary == GOOD_SUMMARY


@pytest.mark.parametrize(
    "payload, reason",
    [
        ({"summary": "", "example": GOOD_EXAMPLE}, "empty summary"),
        ({"summary": GOOD_SUMMARY, "example": ""}, "empty example"),
        ({"summary": "Too short.", "example": GOOD_EXAMPLE}, "summary below minimum"),
        ({"summary": "x" * 2000, "example": GOOD_EXAMPLE}, "summary above maximum"),
        ({"summary": GOOD_SUMMARY, "example": "no"}, "example below minimum"),
        ({"summary": "In this lesson " + GOOD_SUMMARY, "example": GOOD_EXAMPLE}, "boilerplate opener"),
        ({"summary": GOOD_SUMMARY + "```", "example": GOOD_EXAMPLE}, "code fence"),
        ({"summary": GOOD_SUMMARY, "example": GOOD_SUMMARY}, "example repeats summary"),
        ({}, "missing keys"),
    ],
)
def test_validation_rejects_unusable_output(payload, reason):
    with pytest.raises(GenerationError):
        validate(payload, "x")


# ---------------------------------------------------------------- transport

async def test_generate_parses_a_good_response(patch_httpx):
    patch_httpx(_stub_transport(_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE)))
    result = await generate_concept(
        title="Write-Ahead Logging", topic_name="Software Engineering",
        angle=None, api_key="test-key", model="gemini-2.0-flash",
    )
    assert result.summary == GOOD_SUMMARY
    assert result.model == "gemini-2.0-flash"
    assert result.prompt_version


async def test_missing_api_key_is_an_error():
    with pytest.raises(GenerationError, match="not configured"):
        await generate_concept(title="x", topic_name="y", angle=None, api_key="", model="m")


async def test_rate_limiting_is_reported(patch_httpx):
    patch_httpx(_stub_transport({}, status=429))
    with pytest.raises(GenerationError, match="rate limited"):
        await generate_concept(title="x", topic_name="y", angle=None, api_key="k", model="m")


async def test_non_json_body_is_rejected(patch_httpx):
    patch_httpx(_stub_transport({"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}))
    with pytest.raises(GenerationError, match="not valid JSON"):
        await generate_concept(title="x", topic_name="y", angle=None, api_key="k", model="m")


async def test_unexpected_shape_is_rejected(patch_httpx):
    patch_httpx(_stub_transport({"nope": True}))
    with pytest.raises(GenerationError, match="unexpected response shape"):
        await generate_concept(title="x", topic_name="y", angle=None, api_key="k", model="m")


# ---------------------------------------------------------------- pool

async def test_generate_one_publishes_and_marks_the_backlog(session, patch_httpx):
    patch_httpx(_stub_transport(_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE)))
    before = await session.scalar(text("select count(*) from public.concepts where source = 'gemini'"))

    concept_id = await generate_one(session, "test-key", "gemini-2.0-flash")
    assert concept_id is not None

    after = await session.scalar(text("select count(*) from public.concepts where source = 'gemini'"))
    assert after == before + 1

    row = (await session.execute(text("""
        select c.status, c.source, c.model, c.prompt_version, b.status as backlog_status
          from public.concepts c join public.concept_backlog b on b.slug = c.slug
         where c.id = :id
    """), {"id": concept_id})).one()
    assert row.status == "published"
    assert row.source == "gemini"
    assert row.model and row.prompt_version, "provenance must be recorded"
    assert row.backlog_status == "done"


async def test_failed_generation_leaves_the_item_retryable(session, patch_httpx):
    patch_httpx(_stub_transport({}, status=500))
    claimed_before = await session.scalar(
        text("select count(*) from public.concept_backlog where status = 'pending'"))

    assert await generate_one(session, "test-key", "gemini-2.0-flash") is None

    row = (await session.execute(text("""
        select status, attempts, last_error from public.concept_backlog
         where last_error is not null order by updated_at desc limit 1
    """))).one()
    assert row.status == "pending", "one failure should not retire a title"
    assert row.attempts == 1
    assert row.last_error

    after = await session.scalar(
        text("select count(*) from public.concept_backlog where status = 'pending'"))
    assert after == claimed_before, "the item returned to the queue"


async def test_repeated_failures_retire_the_item(session, patch_httpx):
    patch_httpx(_stub_transport({}, status=500))
    # An inactive topic of its own, so this cannot disturb the shared backlog
    # that the other tests draw from.
    topic_id = (await session.execute(text("""
        insert into public.topics (slug, name, is_active, sort_order)
        values ('test-cursed', 'Cursed Topic', false, 99)
        returning id
    """))).scalar_one()
    await session.execute(text("""
        insert into public.concept_backlog (topic_id, slug, title, status)
        values (:tid, 'cursed-title', 'Cursed Title', 'pending')
    """), {"tid": topic_id})
    await session.commit()

    for _ in range(3):
        await generate_one(session, "test-key", "gemini-2.0-flash", topic_id)

    row = (await session.execute(text(
        "select status, attempts from public.concept_backlog where slug = 'cursed-title'"))).one()
    assert row.status == "failed", "a title that never works must stop blocking the queue"
    assert row.attempts == 3


async def test_rate_limit_releases_the_claim_and_refunds_the_attempt(session, patch_httpx):
    patch_httpx(_stub_transport({}, status=429))
    pending_before = await session.scalar(
        text("select count(*) from public.concept_backlog where status = 'pending'"))
    attempts_before = await session.scalar(
        text("select coalesce(sum(attempts), 0) from public.concept_backlog"))

    with pytest.raises(RateLimitedError):
        await generate_one(session, "test-key", "gemini-2.0-flash")

    pending_after = await session.scalar(
        text("select count(*) from public.concept_backlog where status = 'pending'"))
    attempts_after = await session.scalar(
        text("select coalesce(sum(attempts), 0) from public.concept_backlog"))
    assert pending_after == pending_before, "the item returned to the queue"
    assert attempts_after == attempts_before, "throttling must not spend an attempt"


async def test_retry_delay_is_read_from_the_response():
    response = httpx.Response(429, text='{"error": {"details": [{"retryDelay": "12s"}]}}')
    assert generation._retry_after_seconds(response) == 12.0


async def test_stale_generating_rows_are_reclaimed(session):
    """Issue #37: a row abandoned mid-generation by a crashed worker must not be
    stuck in 'generating' forever — a later run reclaims it to 'pending'."""
    topic_id = (await session.execute(text("""
        insert into public.topics (slug, name, is_active, sort_order)
        values ('test-reap', 'Reap Topic', false, 98)
        returning id
    """))).scalar_one()
    # One stranded (claimed long ago) and one legitimately in flight (just now).
    await session.execute(text(f"""
        insert into public.concept_backlog (topic_id, slug, title, status, claimed_at)
        values
          (:tid, 'stranded', 'Stranded', 'generating',
           now() - make_interval(mins => {pool.STALE_CLAIM_MINUTES + 5})),
          (:tid, 'in-flight', 'In Flight', 'generating', now())
    """), {"tid": topic_id})
    await session.commit()

    # minimum_per_topic=0 → no generation happens; only the reaper runs.
    await top_up(session, api_key="k", model="m", enabled=True,
                 minimum_per_topic=0, call_cap=100)

    rows = dict((await session.execute(text("""
        select slug, status from public.concept_backlog
         where slug in ('stranded', 'in-flight')
    """))).all())
    assert rows["stranded"] == "pending", "the abandoned claim must be reclaimed"
    assert rows["in-flight"] == "generating", "a fresh claim must be left alone"


async def test_slug_collision_does_not_mark_the_backlog_done(session, patch_httpx):
    """Issue #37: if the concept slug already exists the insert is a no-op, so the
    backlog row must be flagged failed — not marked done, which would retire the
    title having burned a Gemini call without publishing anything."""
    patch_httpx(_stub_transport(_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE)))
    topic_id = (await session.execute(text("""
        insert into public.topics (slug, name, is_active, sort_order)
        values ('test-collision', 'Collision Topic', false, 97)
        returning id
    """))).scalar_one()
    # A published concept already owns the slug the backlog row will generate.
    await session.execute(text("""
        insert into public.concepts (topic_id, slug, title, summary, status, source)
        values (:tid, 'dup-slug', 'Existing', 'x', 'published', 'seed')
    """), {"tid": topic_id})
    await session.execute(text("""
        insert into public.concept_backlog (topic_id, slug, title, status)
        values (:tid, 'dup-slug', 'Duplicate', 'pending')
    """), {"tid": topic_id})
    await session.commit()

    concept_id = await generate_one(session, "test-key", "gemini-2.0-flash", topic_id)
    assert concept_id is None, "nothing was inserted, so no concept id is returned"

    row = (await session.execute(text(
        "select status from public.concept_backlog where slug = 'dup-slug'"))).one()
    assert row.status == "failed", "a slug collision must not be recorded as done"
    # The pre-existing concept is untouched — exactly one row owns the slug.
    count = await session.scalar(
        text("select count(*) from public.concepts where slug = 'dup-slug'"))
    assert count == 1
    response = httpx.Response(429, headers={"retry-after": "30"}, text="{}")
    assert generation._retry_after_seconds(response) == 30.0
    assert generation._retry_after_seconds(httpx.Response(429, text="{}")) is None


async def test_top_up_backs_off_and_retries_after_a_rate_limit(session, patch_httpx, monkeypatch):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={})
        return httpx.Response(200, json=_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE))

    patch_httpx(httpx.MockTransport(handler))
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(pool.asyncio, "sleep", fake_sleep)
    result = await top_up(session, api_key="k", model="gemini-2.0-flash", enabled=True,
                          minimum_per_topic=25, call_cap=2)
    assert result.generated == 1, "the throttled call was retried, not counted as failed"
    assert sleeps and sleeps[0] >= pool.BACKOFF_START_SECONDS


async def test_top_up_gives_up_after_consecutive_rate_limits(session, patch_httpx, monkeypatch):
    patch_httpx(_stub_transport({}, status=429))

    async def fake_sleep(seconds):
        pass

    monkeypatch.setattr(pool.asyncio, "sleep", fake_sleep)
    result = await top_up(session, api_key="k", model="gemini-2.0-flash", enabled=True,
                          minimum_per_topic=25, call_cap=200)
    assert result.generated == 0 and result.failed == 0
    assert result.skipped_reason == "rate limited"


async def test_top_up_respects_the_kill_switch(session):
    result = await top_up(session, api_key="k", model="m", enabled=False,
                          minimum_per_topic=25, call_cap=200)
    assert result.generated == 0
    assert result.skipped_reason == "generation disabled"


async def test_top_up_without_a_key_does_nothing(session):
    result = await top_up(session, api_key="", model="m", enabled=True,
                          minimum_per_topic=25, call_cap=200)
    assert result.skipped_reason == "no API key configured"


async def test_top_up_stops_at_the_call_cap(session, patch_httpx):
    patch_httpx(_stub_transport(_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE)))
    result = await top_up(session, api_key="k", model="gemini-2.0-flash", enabled=True,
                          minimum_per_topic=25, call_cap=3)
    assert result.generated == 3
    assert result.skipped_reason == "daily call cap reached"


async def test_top_up_fills_only_topics_below_the_threshold(session, patch_httpx):
    patch_httpx(_stub_transport(_gemini_response(GOOD_SUMMARY, GOOD_EXAMPLE)))

    threshold = 6
    # Derive the expected work from the current catalog rather than assuming it:
    # earlier tests in this session may already have published concepts.
    deficits = (await session.execute(text("""
        select greatest(:t - (select count(*) from public.concepts c
                              where c.topic_id = tp.id and c.status = 'published'), 0) as deficit,
               (select count(*) from public.concept_backlog b
                 where b.topic_id = tp.id and b.status = 'pending') as pending
          from public.topics tp where tp.is_active
    """), {"t": threshold})).all()
    expected = sum(min(d.deficit, d.pending) for d in deficits)

    result = await top_up(session, api_key="k", model="gemini-2.0-flash", enabled=True,
                          minimum_per_topic=threshold, call_cap=100)
    assert result.generated == expected

    # The invariant that matters: no active topic is left short.
    short = (await session.execute(text("""
        select tp.slug from public.topics tp
         where tp.is_active
           and (select count(*) from public.concepts c
                 where c.topic_id = tp.id and c.status = 'published') < :t
    """), {"t": threshold})).scalars().all()
    assert short == [], f"topics left below the threshold: {short}"


async def test_dry_followed_topic_schedules_prefetch_not_inline_generation(
    session, user, monkeypatch
):
    """Issue #43: the request never calls Gemini inline. When a followed topic
    runs dry, selection schedules a background prefetch for it and serves today
    from the wider catalog (or reports exhaustion) — it does not block on a
    2–4 s generation. (This supersedes the synchronous on-demand path from #29:
    the pool is meant to refill ahead of demand, not on the request thread.)"""
    from tests.test_selection import DAY

    # Record prefetch requests instead of spawning a real background task, so the
    # test asserts intent without a detached generation running past its end.
    prefetched: list = []
    monkeypatch.setattr(selection, "request_prefetch", lambda tid: prefetched.append(tid))

    await set_followed_topics(session, user, ["linux-systems"])
    # A pending backlog row means the dry-topic branch has a topic to prefetch,
    # regardless of what earlier tests left in the shared backlog.
    await session.execute(text("""
        insert into public.concept_backlog (topic_id, slug, title, status)
        select t.id, 'test-ondemand-linux', 'Test On-Demand Linux', 'pending'
          from public.topics t where t.slug = 'linux-systems'
        on conflict (slug) do nothing
    """))
    await session.commit()

    published = await session.scalar(text("""
        select count(*) from public.concepts c
          join public.topics t on t.id = c.topic_id
         where t.slug = 'linux-systems' and c.status = 'published'
    """))

    # Drain the followed shelf: one lesson a day, all from the followed topic.
    for offset in range(published):
        result = await get_or_create_daily(session, user, today=DAY + timedelta(days=offset))
        assert result.status == "ok"
        assert result.concept.topic_slug == "linux-systems"
        assert result.outside_followed_topics is False

    linux_topic_id = await session.scalar(
        text("select id from public.topics where slug = 'linux-systems'")
    )

    # The day past the shelf: no inline generation. Selection widens to the
    # catalog for today (flagged) or reports exhaustion, and has asked to
    # prefetch linux-systems ahead of demand.
    beyond = await get_or_create_daily(session, user, today=DAY + timedelta(days=published))
    if beyond.status == "ok":
        assert beyond.outside_followed_topics is True, "a dry topic widens, never generates inline"
    else:
        assert beyond.status == "exhausted"
    assert linux_topic_id in prefetched, "selection must schedule a prefetch for the dry topic"

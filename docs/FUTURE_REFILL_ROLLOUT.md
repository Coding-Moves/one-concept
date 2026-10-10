# Future curated-card refill rollout

Issue #353 keeps future lesson refill separate from legacy enrichment and editorial
corrections. Every generated lesson remains a private draft until a reviewer
approves the exact version.

The first reviewed launch plan is
[`backend/content/curriculum.refill-launch.json`](../backend/content/curriculum.refill-launch.json):
one distinct lesson for each existing subject, with a learning objective and
primary source. The production backend image contains this file. It is a
bounded starting backlog, not an infinite AI curriculum planner. Add further
reviewed plans as readers use these lessons.

## Release procedure

Migration `0043_future_refill_daily_usage.sql` is already recorded as applied
in production. Do not reapply or edit it. Enable future refill only after a
separate release and operator review of the existing-lesson backfill.

1. Verify the deployed API and worker revisions match the release commit.
2. Verify the existing `future_refill_daily_usage` tables still have RLS enabled
   and neither `anon` nor `authenticated` can read or write them.
3. Deploy the API and every generation-capable Railway worker with the same
   variables. Keep `GEMINI_API_KEY` in Railway Variables only.
4. From the deployed backend image, import the reviewed launch plan once with
   `python -m app.workers.content import-curriculum content/curriculum.refill-launch.json`.
   The command is transactional and an exact re-import is safe. Inspect any
   overlap warning against the live catalog before leaving the plans in the
   queue. A duplicate or missing prerequisite is an import failure that needs
   a corrected plan; never bypass catalog validation.

## Initial Railway values

Set these values consistently on the API, `pool-topup`/prefetch worker, and any
other service that runs future refill:

```text
GEMINI_MODEL=gemini-3.1-flash-lite
GENERATION_ENABLED=false
FUTURE_REFILL_ENABLED=false
LEGACY_ENRICHMENT_ENABLED=false
CONTENT_LOW_WATERMARK=10
CONTENT_CRITICAL_WATERMARK=3
FUTURE_REFILL_DAILY_CALL_CAP=5
FUTURE_REFILL_TOPIC_DAILY_CAP=1
FUTURE_REFILL_URGENT_ENABLED=false
FUTURE_REFILL_URGENT_DAILY_CALL_CAP=10
FUTURE_REFILL_URGENT_TOPIC_DAILY_CAP=2
EDITORIAL_AUTO_CORRECTION_ENABLED=true
```

`GENERATION_ENABLED=false`, `FUTURE_REFILL_ENABLED=false`, and
`FUTURE_REFILL_DAILY_CALL_CAP=0` are independent
immediate stops. The future-refill worker creates one lesson per eligible topic
per normal day regardless of the older `CONTENT_GENERATION_BATCH` setting; do
not lower that general legacy/correction setting for this rollout. Do not enable
urgent mode during the first rollout.
`FUTURE_REFILL_ENABLED=false` also blocks owner requests for new planned drafts
while existing published lessons are being enriched; AI corrections and the
separately enabled legacy batch remain private review paths.

After the launch plan is imported and the deployed worker is healthy, set
`GENERATION_ENABLED=true` and `FUTURE_REFILL_ENABLED=true` on the API and
`pool-topup` services, keeping the caps above. The scheduled worker checks
active reader demand and prepares at most one new private draft per low-supply
subject per normal day. It skips subjects with no plan or full review capacity.
The owner can verify the reason in content health and AI requests. Railway's
current `22:00 UTC` schedule corresponds to `03:00` in Pakistan; check the
actual schedule before promising that hour. Do not turn on urgent refill until
the first normal day has been inspected.

A reviewer's **Request changes** decision queues one private AI correction
when generation is enabled. The job stays bound to that reviewer and is
cancelled if the membership is revoked before processing. The worker runs it
on its next scheduled or manually started pass; it does not edit or publish
the existing lesson. Set `EDITORIAL_AUTO_CORRECTION_ENABLED=false` to pause
new automatic correction requests while leaving existing queued jobs intact.

## First-day verification

After deployment, enable `GENERATION_ENABLED=true` and
`FUTURE_REFILL_ENABLED=true` for one day and use the protected operations
report to confirm:

- no more than five future-refill calls were reserved;
- each low topic used no more than one call;
- only topics at or below ten unread published cards were eligible;
- generated lessons are drafts and wait for ordinary review;
- editorial corrections and legacy batch work do not affect the refill ledger.

Approve one draft through the editorial workflow and verify it appears in the
learner app only after publication. If the provider rate-limits, review capacity
is full, or an allowance is exhausted, the worker logs a bounded reason and
stops without retrying on the HTTP request path.

## Urgent mode and rollback

Enable urgent mode only after reviewing a full day of quota and reviewer-load
evidence. It allows a critical topic (three unread cards or fewer) a second call
that day, under the separate ten-call global ceiling.

To pause safely, set `FUTURE_REFILL_ENABLED=false`, `GENERATION_ENABLED=false`, or
`FUTURE_REFILL_DAILY_CALL_CAP=0` on every generation-capable Railway service and
redeploy or restart them. Existing published lessons and private drafts remain
unchanged.

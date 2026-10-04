# Future curated-card refill rollout

Issue #353 keeps future lesson refill separate from legacy enrichment and editorial
corrections. Every generated lesson remains a private draft until a reviewer
approves the exact version.

## Release procedure

Do this only after the implementation PR is merged into `develop` and the
release PR is ready to deploy. Migration `0043_future_refill_daily_usage.sql`
is not recorded in `backend/migrations/applied.txt` until it has been applied
and verified in production.

1. Take the normal production database backup.
2. Apply the pending production migrations, including `0043`.
3. Verify both `future_refill_daily_usage` tables have RLS enabled and neither
   `anon` nor `authenticated` can read or write them.
4. Only after that verification, record `0043` in `backend/migrations/applied.txt`
   in the release follow-up.
5. Deploy the API and every generation-capable Railway worker with the same
   variables. Keep `GEMINI_API_KEY` in Railway Variables only.

## Initial Railway values

Set these values consistently on the API, `pool-topup`/prefetch worker, and any
other service that runs future refill:

```text
GEMINI_MODEL=gemini-3.1-flash-lite
GENERATION_ENABLED=false
CONTENT_LOW_WATERMARK=10
CONTENT_CRITICAL_WATERMARK=3
FUTURE_REFILL_DAILY_CALL_CAP=5
FUTURE_REFILL_TOPIC_DAILY_CAP=1
FUTURE_REFILL_URGENT_ENABLED=false
FUTURE_REFILL_URGENT_DAILY_CALL_CAP=10
FUTURE_REFILL_URGENT_TOPIC_DAILY_CAP=2
```

`GENERATION_ENABLED=false` and `FUTURE_REFILL_DAILY_CALL_CAP=0` are independent
immediate stops. The future-refill worker creates one lesson per eligible topic
per normal day regardless of the older `CONTENT_GENERATION_BATCH` setting; do
not lower that general legacy/correction setting for this rollout. Do not enable
urgent mode during the first rollout.

## First-day verification

After deployment, enable generation for one day and use the protected operations
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

To pause safely, set `GENERATION_ENABLED=false` or
`FUTURE_REFILL_DAILY_CALL_CAP=0` on every generation-capable Railway service and
redeploy or restart them. Existing published lessons and private drafts remain
unchanged.

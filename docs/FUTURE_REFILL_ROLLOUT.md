# Future curated-card refill

Issue #353 keeps new lesson generation separate from legacy enrichment and
editorial corrections. Gemini drafts from a human-curated title plan; it does
not choose the curriculum or publish to learners. Every generated lesson stays
private until a reviewer approves and publishes its exact revision.

The original five-subject starting plan is
[`backend/content/curriculum.refill-launch.json`](../backend/content/curriculum.refill-launch.json).
It is a bounded historical seed, not an infinite planner. Import further
reviewed titles as readers consume lessons. An empty pending plan cannot be
fixed by increasing a model quota or turning on a scheduler.

## Before enabling production refill

1. Confirm the production API and Edge worker were deployed from the intended
   `main` commit through the protected workflow in [RELEASING.md](../RELEASING.md).
   Verify migration `0043_future_refill_daily_usage.sql` and later worker
   migrations against the actual production schema. Do not edit applied SQL.
2. Review the current catalog, private drafts and pending revisions. Publish
   only exact lesson versions that pass the full editorial checklist. A full
   review queue blocks new claims by design.
3. Inspect failed planned titles individually. Correct duplicates, content
   validation problems or provider configuration before granting an audited
   retry; never reset all failed rows. See [content operations](CONTENT_OPERATIONS.md).
4. Import a reviewed plan with distinct slugs, objectives, prerequisites and
   sources. The Python maintainer CLI can import it using the intended Supabase
   database connection, but verify the project ref and a dry-run plan first.
   Exact re-import is safe; an overlap warning still needs human inspection.
5. Verify the production Edge worker has its private Gemini key and model,
   bounded call caps, and the `content_pool` Cron job. Keep `FUTURE_REFILL_ENABLED`
   false until the plan and reviewer capacity are ready. Staging and production
   project refs and secrets must stay separate.

## Controlled activation

The production Edge worker reads `GENERATION_ENABLED` and
`FUTURE_REFILL_ENABLED` independently. Both must be true for curated refill.
Enable the `content_pool` row in `edge_worker_jobs` and its matching Cron job
only after checking the exact production project and target worker URL. The
normal path claims at most one private draft per eligible low-supply topic per
day, bounded by `FUTURE_REFILL_DAILY_CALL_CAP=5` and
`FUTURE_REFILL_TOPIC_DAILY_CAP=1`. Leave urgent refill disabled on the first day.
The worker skips topics with no pending plan, a full review queue, no active
reader demand, or exhausted allowance. Learner HTTP requests do not wait for a
model call.

Reviewer's **Request changes** can queue a separate private AI correction when
`EDITORIAL_AUTO_CORRECTION_ENABLED=true`. It does not publish a replacement.
Legacy enrichment uses its own job and review path. Do not infer that either
worker creates new curriculum titles.

## First-day verification and pause

Inspect `cron.job`, `edge_worker_jobs`, and the latest terminal
`edge_worker_runs` for `content_pool`. Confirm `status=succeeded`,
`disabled=0`, and a valid HTTP receipt. Check the plan, draft, failure and
`future_refill_daily_usage` counts. No more than five normal calls should be
reserved globally and one per eligible topic. A generated draft must appear
in the review queue and become available to learners only after publication.

To pause new work, set `FUTURE_REFILL_ENABLED=false` or the daily call cap to
zero, and turn off the `content_pool` Cron and worker gates if needed. Existing
published lessons, private drafts and review evidence remain intact. Recheck
the latest worker run rather than treating a successful dispatch as proof that
a card was generated or published.

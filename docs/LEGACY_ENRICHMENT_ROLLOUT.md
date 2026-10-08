# Complete existing lessons, one subject at a time

Migration `0042_legacy_enrichment_batches.sql` is already recorded as applied
in production. Do not reapply or edit it. The new worker and owner controls use
those existing tables. This change needs a normal `develop` → `main` release
after its feature PR is reviewed; merging the feature PR into `develop` alone
does not deploy the live website, API, or worker.

## Safe first run

1. Keep `FUTURE_REFILL_ENABLED=false` on the API and `pool-topup`. This prevents
   new lesson generation while the existing library is being reviewed.
2. Configure a Gemini 3 model and `GEMINI_API_KEY` privately in Railway Variables
   for both `api` and `pool-topup`. Do not put the key in GitHub, Netlify, mobile,
   an issue, a screenshot, or chat. Google's search grounding is unavailable
   on the Gemini free tier and can incur search-query charges on a paid project;
   verify billing and quotas before use. An ungrounded result is blocked rather
   than published with invented references.
3. Set `GENERATION_ENABLED=true` and `LEGACY_ENRICHMENT_ENABLED=true` on both
   services. For the owner's one-subject-per-day run, confirm the `pool-topup`
   service uses the daily cron and `LEGACY_ENRICHMENT_BATCH_SIZE=75` (or has no
   override, so the 75-attempt default applies). This permits 25 cards with up
   to three attempts each in one scheduled run; it does not promise 25 valid
   results. Set the shared `GENERATION_DAILY_CALL_CAP` on both services high
   enough for the chosen batch budget and other generation jobs, and check the
   paid project's rate and spending limits before starting. Keep
   `FUTURE_REFILL_ENABLED=false` so those calls are not used for new cards.
4. In the owner website, open **AI requests → Complete existing published
   lessons**. Select one subject and inspect its eligible count. Set a maximum
   Gemini-call budget that covers at least that count (75 allows all three
   attempts for each of 25 cards); retries consume the same budget. Confirm
   the subject has enough free review capacity, then enter an audit reason and
   prepare the batch. Preparing makes no provider call. Press **Start / resume**
   before that day's scheduled worker run. Select the next subject yourself on
   the next day, after the current batch reaches a terminal state.
5. After the scheduled `pool-topup` run, refresh the batch and count entries
   marked **Ready for review**. If fewer than the eligible count are ready,
   inspect blocked/failed entries, the daily call budget, review capacity, and
   Railway's worker logs before deciding whether to run the worker again that
   day. A provider rate limit can stop a pass early; do not assume completion
   merely because the cron job exited. Inspect every
   result in the review queue, open its sources, and check the complete
   explanation, example, flashcard, and three answers. Assign a reviewer and
   publish each revision only after a human decision. Blocked/failed entries
   remain visible for manual correction or a later batch.
6. In the learner app, confirm a published revised lesson displays the exact
   reviewer credit and current body. A prepared draft must not change the
   learner card. Use another account to check reviewer permissions and assignment
   notifications. Check the backend deployment commit and Netlify production
   branch before treating this as a live test.

The batch snapshots only eligible published lessons in one subject. A complete
current version with a publication record is excluded. An incomplete card is
eligible even if it was previously attested, so older missing flashcards or
questions are not skipped. Lessons with an active draft or an already prepared
legacy revision are excluded. A rejected prepared
revision stays in review history; use a manual correction rather than silently
replacing that decision with another generated batch. Only one batch can be
active across subjects. A batch is private
work, not a release or automatic publication. Completion of old lesson bodies
does **not** create new concept IDs: a learner who exhausted Software
Engineering may still receive a card from another followed or eligible subject
until separately reviewed new Software Engineering lessons are published.

## Pause, failures, and cost

Use **Pause** in the owner website to stop new claims. A result in flight is
fenced from staging until resumed; **Cancel** skips outstanding entries while
retaining already prepared private drafts. Alternatively set
`LEGACY_ENRICHMENT_ENABLED=false` on API and worker and redeploy/restart both.
Keep `FUTURE_REFILL_ENABLED=false` throughout the backfill. A provider failure
or rate limit never publishes a lesson; attempts and errors are visible in the
batch. A missing grounded source blocks the entry for human inspection.

After all subjects are reviewed, turn off `LEGACY_ENRICHMENT_ENABLED`, rotate
or remove any temporary Gemini key, and verify the final values on every
generation-capable service. Future refill has its own controlled rollout in
`docs/FUTURE_REFILL_ROLLOUT.md`; do not enable it merely because legacy review
is complete.

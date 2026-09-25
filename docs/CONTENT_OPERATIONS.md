# Content operations runbook

This runbook implements [the sustainable learning architecture](CONTENT_ARCHITECTURE.md)
for #195. The repository owner is the initial content operator and reviewer.
Broader crash reporting and application observability remain in #161.

## Access and rollout

All commands below run from `backend/` with its virtual environment and a
maintainer's backend database configuration. The content CLI has no public HTTP
route. New operational tables have RLS enabled and no mobile policies. Never
put backend credentials in an import file, screenshot, PR or mobile configuration.

Before deploying this backend, back up the database and apply migrations
**0011–0015 in order** through the existing direct/session migration connection.
Do not add their names to `migrations/applied.txt` until production application
has actually been verified. These migrations add supply targets, editorial
history, reviews, health state and correction claims; they preserve existing
lesson IDs, assignment constraints and completed dates.

Pause API demand generation and scheduled generation during the transition.
Deploy the backend before the JS update. Old APKs retain the existing daily
contract; updated clients opt into `reviews=true` on the compact state endpoint.
No native module, app version or runtime change is included in this feature PR.
Deploy this backend consistently to the API and workers: an old worker would
bypass the new draft gate. Restart paused jobs only after all old generators are
stopped, all five migrations are verified, and the shared daily quota rollout
in [the backend guide](../backend/README.md#shared-generation-budget) is satisfied.

## Operating policy and schedule

| Setting | Default | Meaning |
| --- | ---: | --- |
| `MIN_POOL_PER_TOPIC` | 25 | Bootstrap inventory floor; never the continuing-learning ceiling. |
| `CONTENT_RESERVE_PER_TOPIC` | 60 | Desired unseen lessons for the most experienced active reader. |
| `CONTENT_LOW_WATERMARK` | 5 | Urgent supply warning and demand-trigger threshold. |
| `CONTENT_ACTIVE_DAYS` | 90 | Reader had a new assignment or review assigned within this many days. |
| `CONTENT_PLANNED_RESERVE` | 90 | Warning threshold for available pending titles per subject. |
| `CONTENT_GENERATION_BATCH` | 5 | Maximum attempts per subject in a normal scheduled/prefetch pass, excluding bounded throttling retries. |
| `GENERATION_MAX_CONCURRENT` | 3 | Shared simultaneous provider calls, including correction drafting. |
| `GENERATION_DAILY_CALL_CAP` | 200 | Existing default Pacific-day reservation cap; set a lower affordable cap before enabling. |
| `GENERATION_ENABLED` | false | Kill switch for scheduled, demand and correction workers. |
| `GENERATION_ON_DEMAND` | true | Permit bounded background wakes from daily demand when the kill switch allows generation. |

The reserve estimate assumes **one new lesson per subject per day**, a
conservative bound for a reader concentrating on one subject. Following five
subjects does not create five daily assignments. Start with a reviewed publication
plan the operator can sustain: for example, review enough material weekly to
publish around one new lesson per active subject per day. This is an operating
target, not an automatic guarantee. A five-call daily cap can limit initial
spend; validation failures consume calls and may reduce approved output. The
configured cap is not proof of the provider's quota or pricing.

For the VM migration, [VM_DEPLOYMENT.md](VM_DEPLOYMENT.md) supplies supervised
schedules (04:00 UTC daily supply, hourly observations) and the protected
`sudo one-concept content ...` / `sudo one-concept rewrite` entry points.
Provisioning and activation remain deferred; the deploy key cannot publish
content. Commands below remain valid for a separately configured maintainer.

Configure the chosen hosting scheduler to run:

- `python -m app.workers.pool_topup` at least daily, before the editorial review session.
- `python -m app.workers.content report --observe` hourly, retaining job output.
- A human curriculum/publication review weekly, with a brief daily check of urgent conditions.

Verify scheduler history and the report's worker finish time after configuration.
The PR does not configure a live scheduler. A run overdue by 36 hours is reported.
`report --observe` writes shared condition state and emits only transitions,
including recovery; unchanged runs print nothing. It does not send Slack/email
messages. A job-output collection failure can miss a transition, so use the full
`report` snapshot during incident investigation. Do not run overlapping manual
bulk rewrites deliberately; durable claims also protect accidental overlap.

## Inspect supply and failures

```bash
.venv/bin/python -m app.workers.content report
.venv/bin/python -m app.workers.content report --observe
.venv/bin/python -m app.workers.content failures
.venv/bin/python -m app.workers.content drafts
.venv/bin/python -m app.workers.content show REVISION_UUID
```

The report separates published, draft, pending, failed, generating and stale
work; it includes experienced-reader unseen availability, estimated reserve,
last generation/publication, daily reservations, and worker finish state.
Drafts occupy inventory capacity until reviewed; an approval backlog must not
cause unlimited new drafts. Low planned reserve means the curriculum needs work,
not that the model needs more automatic retries.

A read-only production classification on 2026-09-13 found the existing **26 failed
entries**: **18 throttling-related, four content-validation failures and four
unclassified**. All had three attempts. No failures were retried or reset in this
PR. Categories are approximate diagnostics; inspect the specific title/cause
privately before granting a retry. Historical throttling entries may predate the
current attempt-refund behaviour.

`failures` lists up to 100 title slugs with category and attempt/grant counts.
Continue with `failures --after LAST_SLUG`. It never prints raw provider errors.
For unclassified failures, inspect the stored diagnostic privately in the database
console and redact it before sharing.

For each affected title, correct the source, scope, wording or provider setting
first. `revise-plan` can update only pending/failed plans, preserving the slug,
subject identity, status and lifetime attempts. Use a JSON array in the same
format as the import example. Then grant one audited extra attempt:

```bash
.venv/bin/python -m app.workers.content revise-plan corrected-plans.json
.venv/bin/python -m app.workers.content retry TITLE_SLUG \
  --operator 'Muawiya Amir' --reason 'Describe the diagnosed cause and correction'
```

A retry uses the normal shared budget and concurrency limits. A slug collision
requires correcting the existing concept/draft; it cannot be solved by resetting
attempts. Never blanket-reset all failed rows. Stale backlog and correction claims
are recovered after 30 minutes by their workers. If the provider is still slow,
first pause generation and inspect scheduler health instead of deleting live claims.

## Add or retire a subject

`content/subjects.json` describes the current five subjects. Copy the relevant
record into a small import file. To add another subject later, supply a new
stable lowercase slug, display name, description and sort order. New topics do
not require a mobile release or a new API route.

```bash
.venv/bin/python -m app.workers.content import-subjects subject-changes.json
```

Imports upsert the listed slugs only. **Omitting a subject does not delete it.**
Set `is_active: false` explicitly to retire it; set it back to true to restore it.
Do not rename a slug or delete the database record as a retirement mechanism.
Retired subjects leave discovery/new assignment/generation. Existing daily cards,
completed lessons, likes, saved links and reviews remain accessible. A subject
rename changes its display label; the underlying identity remains unchanged.

New users initially follow all active subjects. Existing users choose newly added
subjects through Personalization; adding a subject does not silently rewrite
an existing user's preferences. After a change, check `/v1/topics`, follow it on
a test account, and verify next-day selection. Today's activity stays fixed.

## Extend, draft and approve a curriculum

1. Prepare a JSON array using
   [the five-subject example](../backend/content/curriculum.example.json).
   It demonstrates extension, not a production seed or a complete reserve.
2. Give every concept a stable unique slug, one learning objective, difficulty
   **1 foundations / 2 intermediate / 3 advanced applications**, prerequisite
   slugs where useful, and relevant source references. Separate distinct ideas;
   a renamed duplicate is not library growth.
3. Import with `python -m app.workers.content import-curriculum FILE.json`.
   Exact re-import is safe. Unknown subjects/prerequisites, cycles, duplicate
   slugs and exact title/objective matches are rejected. Similar title warnings
   require editorial inspection; this inexpensive heuristic is not semantic
   proof. Check objectives and source material for conceptual duplication too.
4. Allow the background worker to draft within the shared quota. Daily HTTP
   requests never wait for this work. Use `drafts` and `show` to inspect results.
5. Verify factual correctness, scope, example usefulness, reading length,
   prerequisite availability and references. Import warnings are not approval.
   A reference URL is not evidence that the generated text actually follows it.
6. If a draft needs changes, save its lesson body as JSON and run
   `python -m app.workers.content stage SLUG BODY.json`. The body contains
   `title`, `summary`, `example`, `curriculum`, optional `model` and
   `prompt_version`. The CLI prints a revision UUID.
7. Publish the exact reviewed revision:

   ```bash
   .venv/bin/python -m app.workers.content publish REVISION_UUID \
     --reviewed-by 'Muawiya Amir' \
     --note 'Explain which source, factual claims and example were verified'
   ```

Publication requires complete metadata, valid prerequisites already published,
an active subject, and a current base version. It rejects exact duplicates and
stale competing revisions. Repeating an approved revision is a no-op. Approve
prerequisites before dependent lessons. Selection favours known prerequisites
and lower difficulty within topic rotation; prerequisites are a sequencing
preference rather than a hard lock that strands readers who skipped a lesson.

Legacy published content remains readable. Legacy pending titles can still
produce drafts, but their initially empty curriculum metadata cannot pass the
new publication gate: complete it through `stage` before approval. The example
extension and existing plans must continue to grow through maintainer work;
there is no automatic source of infinite high-quality titles.

Reject an unsuitable revision with `reject REVISION_UUID --reviewed-by NAME
--note REASON`. Rejection preserves the audit trail. A new draft concept remains
in inventory so it can be corrected with `stage`; do not repeatedly generate
new copies to evade review. Resolve rejected inventory during the weekly review.

## Correct a published lesson

Use `stage` with the same slug, then review and publish its revision. Existing
published text stays visible while the correction is pending. Publication
increments `content_version`, preserves the concept UUID/slug and records the
reviewer/note. The previous published body is retained, including an explicitly
labelled legacy snapshot when the original version predates review history.

Two simultaneous corrections cannot overwrite each other silently. After a
stale-version rejection, read the latest body and prepare a fresh revision.
Saved/history references retain their meaning. Offline readers retain their
cached version until the lesson is fetched online; opening details refreshes
it. There is no promise of instantaneous correction on an offline device.

`python -m app.workers.rewrite_catalog` now creates correction drafts instead of
replacing published text. Its durable claims prevent overlapping workers from
drafting the same current revision, and every attempted call spends from the
same budget as new lessons. It obeys the kill switch and requires review afterward.

## Backup, recovery and safe pause

The automated restore rehearsal dumps the disposable PostgreSQL 16 database,
restores into a second database, and compares catalog/progress counts,
constraints and RLS. Production backup/restore must still be rehearsed against
an isolated environment with the actual Supabase Auth setup and access controls.
Never restore over production as an exploratory check.

For a real backup, use the approved direct connection through `PGSERVICE` or a
permission-restricted `.pgpass`, never a password pasted into command history:

```bash
pg_dump --format=custom --no-owner --no-acl --file=one-concept.dump
# Point the approved connection configuration at an empty isolated restore DB:
pg_restore --no-owner --no-acl --exit-on-error --dbname=RESTORE_DATABASE one-concept.dump
```

Provision required Auth schemas/roles in the rehearsal environment according to
the database provider's procedure. Verify counts for concepts, revisions,
assignments, reviews, interactions and budget usage; verify constraints/RLS and
read/complete flows with test identities. Encrypt/restrict backup storage and
record the backup time and restore result privately.

To pause costs, set `GENERATION_ENABLED=false` consistently on API and workers,
and stop manual drafting. Keep the API and stored library online: readers can
continue new lessons and reviews. For a bad publication, stage a correction
from the retained version rather than rewriting history or dropping tables.
An application rollback must retain the new tables and data. Rolling back to
an old generator would bypass editorial gates; keep generation disabled until
compatible workers are restored. Never delete review records to roll back a UI.

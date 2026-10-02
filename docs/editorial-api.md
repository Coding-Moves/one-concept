# Editorial review API (#276)

This is step 3 of [#263](https://github.com/Coding-Moves/one-concept/issues/263),
following identities (#274) and exact-revision evidence (#275). It provides the
backend and an authenticated operator client for the future One Concept Review
website. Dashboard screens are #278, generation/revision orchestration is #277,
and coordinated production activation is #281. This change does not activate
production, invite accounts, send emails or publish lessons.

## Authority and transaction contract

Every route is below `/v1/editorial`. Use a verified Supabase bearer access token
from a confirmed, current session with MFA (`aal2`). Membership must be active,
the registered display name approved, and the required capability present.
`EDITORIAL_ENABLED` must be true in the target environment. Client-supplied names,
roles and actor IDs cannot grant permission or supply attribution.

Reads require `review`, except `/activity`, which requires `manage_reviewers`.
Mutations authorize before waiting for the shared account lock, then take the
catalog lock and recheck current authority. The caller-owned READ COMMITTED
transaction commits the content change, audit evidence and idempotency receipt
together. Exceptions roll everything back; no provider call occurs in that
transaction. Existing account-management endpoints retain their own contract in
[editorial-accounts.md](editorial-accounts.md).

| Endpoint | Capability and behavior |
| --- | --- |
| `GET /queue` | `review`; draft/revision or legacy queue with bounded filters. |
| `GET /revisions/{id}` | `review`; complete body, current source, field diff, validation, safe source links and version token. |
| `GET /concepts/{id}` | `review`; current body/version/status, token, unchanged-legacy eligibility and authenticated provenance. |
| `GET /concepts/{id}/revisions` | `review`; paginated revision metadata; retrieve each full body by revision ID. |
| `GET /concepts/{id}/timeline` | `review`; paginated immutable review and workflow events. |
| `GET /activity` | `manage_reviewers`; workflow events, including generation requests, optionally filtered by topic. |
| `POST /concepts/{id}/revisions` | `review`; stage a complete new `LessonBody` against the current concept token. Does not alter live content. |
| `POST /revisions/{id}/actions` | `review` for submit/comment/changes requested/reject; `approve` for approval or revision retirement; `publish` for publication; both for atomic approval/publication; `manage_reviewers` for assignment. |
| `POST /concepts/{id}/actions` | Both `approve` and `publish` for legacy attestation; `publish` for live-content retirement. |
| `POST /generation-requests` | `request_generation`; record bounded durable demand, not immediate generation or publication. |

All lists return `items` and `next_cursor`; stop when the cursor is null. The
limit defaults to 25 and is capped at 100. Queue, history and activity cursors
are UUIDs ordered by ID, not chronological timestamps. Timeline cursors are
opaque strings ordered by event time and ID. Keep filters fixed when paging;
refresh from the beginning to discover new work. These are live lists rather
than a frozen export snapshot.

Queue filters: `kind=revisions|legacy`, `status`, `topic_id`, `assignee_id`,
`search` (case-insensitive title substring, maximum 120 characters), `cursor`
and `limit`. The default revision queue excludes published/retired revisions;
explicit status filters can retrieve those. Status/assignee filters are invalid
for legacy. Legacy contains inventoried, currently published versions without
authenticated provenance; `unchanged=false` requires a correction rather than
attestation. Retired taxonomy may still appear for inspection but cannot publish.

## Review a lesson

1. Fetch its revision detail and inspect the **entire** package: summary,
   example, curriculum/objective/prerequisites/references, flashcard and three
   MCQs. Read validation errors and the current-source diff. Validation is
   structural/catalog evidence, never proof that generated facts are correct.
2. POST `action: "comment"` with substantive feedback, or use `"submit"` to
   move a valid draft to `pending_review`. Invalid submission records
   `validation_failed`; a successful HTTP response alone is not approval.
3. A pending candidate may receive `"changes_requested"` or `"rejected"` with
   a reason. Stage its correction as a **new revision** using the current concept
   token and complete `body`; do not edit an already reviewed revision. Automated
   regeneration from feedback belongs to #277.
4. For the designated reviewer holding both permissions, the default final
   action is **Approve and publish**. It validates and commits both decisions
   atomically. There is no additional developer publishing step.

Example command body for `/revisions/{id}/actions` (replace the request UUID and
`expected_token` with the actual token returned by the last GET):

```json
{
  "request_id": "186f7d3e-9b1d-4e86-87ba-38c865472531",
  "expected_token": "<64-character token from revision detail>",
  "action": "approve_and_publish",
  "note": "Checked the explanation, worked example and all answers against the listed references.",
  "quality": {
    "factual_accuracy": true,
    "usefulness": true,
    "clarity": true,
    "topic_subtopic_accuracy": true,
    "example_quality": true,
    "flashcard_quality": true,
    "mcq_quality": true,
    "references_checked": true,
    "sensitive_topic_handling": "not_applicable"
  }
}
```

The checklist is server-validated by `QualityReview`; do not check items on behalf
of a human without reviewing them. Approval-only uses `action: "approved"` with
that checklist. A separate publisher uses `action: "publish"` without a new
checklist; the server retrieves the exact stored approval. Quality is forbidden
on unrelated actions. Every command requires a trimmed, substantive note of
10–4000 characters. Assignment uses `action: "assign"` and `assignee_id` (null to
unassign); the assignee must be an active approved reviewer/approver. Assignment
routes work but does not grant permissions or give an exclusive publishing lock.

A successful revision mutation returns its ID, state, new token and optional
`published_version`. Inspect the state before reporting success. Publication
rechecks the exact body, source version, active taxonomy, graph, published
prerequisites in active topics/subtopics, duplicates and approval. Failed atomic
publication leaves no partial approval, publication or successful receipt.

## Stale tabs, retries and errors

- Send `expected_token` from the latest GET for every revision/concept mutation.
  It covers source/body/state and relevant taxonomy/assignment state. A stale
  command returns 409 with a reload instruction; inspect again before a new
  decision. Never silently replace the token and retry approval.
- Generate a UUID `request_id` once per intended command. On a timeout or uncertain
  response, retry the **identical** body with that same ID. The receipt is scoped
  to the verified actor, resource and command. Reusing it for another payload
  returns 409. Concurrent duplicates return the committed result only once.
- Receipt replay still requires current permission/session/MFA. A revoked account
  cannot use an old request ID as a bypass. A receipt reports the original result,
  not a claim that the current resource has remained unchanged; reload afterward.
- 401 means the session/token is unavailable; 403 means authority/MFA is missing;
  404 means a resource was not found; 409 means stale state, invalid transition or
  publication conflict; 413 means payload too large; 422 means invalid input;
  503 means disabled/unavailable service. Show a failure and preserve user input,
  never display Published based on a timeout. Logs must exclude tokens and secrets.

## Legacy verification, corrections and retirement

Existing lessons stay readable without invented reviewer attribution. POST
`action: "attest"` to the concept action endpoint with its current token, note,
request ID and quality checklist. It requires the exact unchanged migration-0033
inventory version and all current package/catalog checks. It records a verified
reviewer name without changing text or incrementing the content version. Invalid
or changed legacy content needs a reviewed correction, not a fabricated badge.

A pending/rejected correction leaves the last published body available. Publishing
updates the same concept ID, increments the version and preserves prior revision
and learner history. `action: "retired"` on a revision cancels that candidate;
`action: "retire"` on a concept archives the live lesson. Neither deletes earned
progress. A retired assignment still occupies that user's daily slot; existing
safe exhaustion/review behavior applies rather than assigning a second lesson.

Once deployed, compatible published content becomes eligible through ordinary
learner API reads: no per-card PR, APK, OTA or backend deployment. It follows
subject, history and daily-assignment rules, does not replace an already assigned
concept and sends no additional learner push notification. Offline clients must
reconnect. Mobile attribution rendering remains #280.

## Demand requests and worker boundary

POST `/generation-requests` with `request_id`, `note`, `topic_id` and integer
`count` (1–10). The generation kill switch must be enabled, the topic active and
planned pending curriculum available. Demand is bounded by pending work and the
configured batch size, written to `content_supply_targets`, and audited. Inventory
excludes retired subtopics, matching the worker. The response, receipt and audit
record report the actual saved target, including larger pre-existing demand.
Repeated requests before inventory changes coalesce rather than accumulating unlimited
work. The 202 result says `demand_recorded`, never Generated or Published.

Existing scheduled workers consume the demand with their normal claims, retry
limits, quota and kill-switch checks. This request does not invoke Gemini, promise
a completion time, create curriculum or send reviewer email. #277 owns further
revision generation integration, and later delivery work owns notifications.
Catalog rewrites stage valid `learning_package` drafts and do not reclaim a
concept while an open review is in progress.

## Private text and operator access

Requests are capped at 64 KiB using the actual streamed bytes, not a trusted
Content-Length header. Schemas reject extra identity fields and bound commands.
Responses are JSON with private/no-store, authorization-varying, nosniff and
restrictive CSP headers. Draft text, comments, references and diff values remain
**untrusted plain text**. The future website must use escaped text nodes, never
HTML insertion or executable Markdown. Link previews must not fetch arbitrary
URLs on the backend. `source_links` allows only HTTP(S) URLs without credentials;
open external links with appropriate browser isolation. Do not render raw body
reference URLs as trusted HTML or use content as executable instructions.

The operator client uses the same HTTP authority/version/checklist/receipt gates:

```bash
# Set EDITORIAL_ACCESS_TOKEN securely to your short-lived MFA user access token.
# Do not paste it into an issue, command argument, repository file or terminal log.
python -m app.workers.editorial_review \
  --api-url https://your-staging-api.example \
  --path '/v1/editorial/queue?kind=revisions&limit=25'

python -m app.workers.editorial_review \
  --api-url https://your-staging-api.example \
  --path /v1/editorial/revisions/REVISION_UUID/actions \
  --body /tmp/editorial-command.json
```

Run from `backend/` in its Python environment. The JSON file holds the command,
not the token. The client enforces HTTPS/editorial paths, refuses redirects,
disables environment proxy inheritance and redacts failures. It accepts neither
a database credential nor a supplied reviewer name as authority. It does not
perform login; obtain the session through the approved Supabase sign-in/MFA flow.

## Publication entry-point audit

| Entry point | Gate/result |
| --- | --- |
| Review HTTP actions and operator CLI | Verified user, exact token, capabilities, checklist, immutable evidence; same transaction gate. |
| `publication.publish_revision` | Delegates to authenticated `publish_reviewed_revision`; `_apply_revision` is internal to that gate. |
| Old `content publish/reject --reviewed-by` | Fails closed; free-text reviewer names cannot authorize writes. |
| Curriculum/subject imports and draft staging | Planning/staging only; no new published lesson. |
| Pool generation and catalog rewrite workers | Create drafts; no authenticated approval and no publication. |
| Flashcard/quiz metadata backfills | Existing-content maintenance, not a sanctioned route to publish new lessons; changed snapshots cannot retain misleading exact-version provenance. |
| Historical seed migrations | Immutable bootstrap history, inventoried once at 0033 cutover; never replay seeds to bypass new-content review. |
| Owner database administration | Privileged SQL is not an ordinary content interface. No bypass/recovery publisher is offered. Restore compatible service and use audited review actions. |

## Migration and rollout handoff

Apply `backend/migrations/0034_editorial_workflow.sql` after 0033 in staging. It
adds assignment metadata, private append-only workflow events and per-actor
idempotency receipts, with RLS and revoked browser-role access. It does not alter
lesson text, send notifications or grant membership. Auth account deletion must
not erase historical actor/name evidence. `backend/migrations/applied.txt` must
change only after actual production application is verified, not to make CI pass.

During #281, deploy the compatible API and workers together; configure the target
origin and existing identity/MFA prerequisites; rehearse the complete review flow
with test content, permissions, stale requests, retry after uncertainty and a
compatible installed app. Verify a new eligible user/day sees approved content
while an existing assignment remains unchanged. Local HTTP/DB tests cover the
selection contract; physical-device and real production rehearsal remain rollout
work. Keep production editorial activation off until that coordinated acceptance.
No manual production action is required merely to merge this backend PR.

On failure, disable editorial actions and retain existing published content and
immutable evidence. Retry uncertain operations with their original request IDs;
fix validation failures by staging a new revision. Do not erase receipts/audit
rows or downgrade to free-text publication to recover. See
[editorial-provenance.md](editorial-provenance.md) for the underlying evidence
contract and [CONTENT_OPERATIONS.md](CONTENT_OPERATIONS.md) for supply operations.

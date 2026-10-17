# Supabase API route parity for #416

Source: current `develop` FastAPI OpenAPI plus four routes excluded from its schema. The target is `/functions/v1/api` with the current `/v1/...` path appended. This is an inventory, not evidence that a candidate route works.

The mobile client calls learner endpoints; the owner/reviewer site calls `/v1/editorial/...`; public visitors use profile JSON and `/p/{token}`. Every `/v1/...` route requires a verified token except public profiles. Editorial routes apply their existing per-route capability and MFA policy; `/v1/editorial/me` can report that MFA is required. The HTML routes belong to #418 because the default Edge URL does not serve HTML as HTML.

| Method | Path | Consumer / authority | Candidate status |
| --- | --- | --- | --- |
| GET | `/health` | Operations / public probe | Candidate; local handler/SQL tests |
| GET | `/v1/editorial/owner/overview` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| GET | `/v1/editorial/owner/reviewers` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| GET | `/v1/editorial/owner/operations` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| GET | `/v1/editorial/owner/events` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| PATCH | `/v1/editorial/me/notification-timezone` | Owner/reviewer site / current session + active membership | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/notifications` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| PATCH | `/v1/editorial/notifications/policy` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| POST | `/v1/editorial/notifications/{batch_id}/retry` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging owner checks pending |
| GET | `/v1/editorial/me` | Owner/reviewer site / current session + active membership | Candidate; local handler/SQL tests, staging role checks pending |
| PATCH | `/v1/editorial/me/profile` | Owner/reviewer site / current session + active membership | Candidate; local handler/SQL tests, staging role checks pending |
| PATCH | `/v1/editorial/me/authenticator` | Owner/reviewer site / current session + active membership + recent TOTP to disable | Candidate; local handler/SQL tests, staging role checks pending |
| GET, POST | `/v1/editorial/reviewers` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role and invitation checks pending |
| PATCH | `/v1/editorial/reviewers/{user_id}/access` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| POST | `/v1/editorial/reviewers/{user_id}/approve-profile` | Owner/reviewer site / manage_reviewers capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/queue` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/taxonomy` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/revisions/{rid}` | Owner/reviewer site / role + capability + MFA | Not ported |
| GET | `/v1/editorial/concepts/{cid}` | Owner/reviewer site / role + capability + MFA | Not ported |
| GET, POST | `/v1/editorial/concepts/{cid}/revisions` | Owner/reviewer site / role + capability + MFA | GET candidate with local handler/SQL tests; POST not ported |
| GET | `/v1/editorial/concepts/{cid}/timeline` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/activity` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| POST | `/v1/editorial/revisions/{rid}/actions` | Owner/reviewer site / role + capability + MFA | Not ported |
| POST | `/v1/editorial/concepts/{cid}/actions` | Owner/reviewer site / role + capability + MFA | Not ported |
| POST | `/v1/editorial/generation-requests` | Owner/reviewer site / role + capability + MFA | Not ported |
| POST | `/v1/editorial/revisions/{rid}/generation-requests` | Owner/reviewer site / role + capability + MFA | Not ported |
| GET | `/v1/editorial/generation-jobs` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/editorial/generation-jobs/{jid}` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| POST | `/v1/editorial/generation-jobs/{jid}/cancel` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL replay tests, staging role checks pending |
| GET | `/v1/editorial/generation-supply/{tid}` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET, POST | `/v1/editorial/legacy-enrichment-batches` | Owner/reviewer site / role + capability + MFA | GET candidate with local handler/SQL tests; POST not ported |
| GET | `/v1/editorial/legacy-enrichment-eligibility/{topic_id}` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| POST | `/v1/editorial/legacy-enrichment-batches/{batch_id}/actions` | Owner/reviewer site / role + capability + MFA | Not ported |
| GET | `/v1/editorial/legacy-enrichment-batches/{batch_id}/entries` | Owner/reviewer site / role + capability + MFA | Candidate; local handler/SQL tests, staging role checks pending |
| GET | `/v1/topics` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/daily` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/daily/complete` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/concepts/{slug}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| PUT, DELETE | `/v1/concepts/{slug}/like` | Mobile / verified learner | Candidate; local handler/SQL tests |
| PUT, DELETE | `/v1/concepts/{slug}/save` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/state` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/history` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/saved` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/stats` | Mobile / verified learner | Candidate; local handler/SQL tests |
| PUT | `/v1/me/topics` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST, DELETE | `/v1/me/push-token` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET, PUT | `/v1/me/notifications` | Mobile / verified learner | Candidate; local handler/SQL tests |
| PATCH | `/v1/me` | Mobile / verified learner | Candidate; local handler/SQL tests |
| PUT, DELETE | `/v1/me/avatar` | Mobile / verified learner | Not ported |
| GET | `/v1/me/subtopics/progress` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/subtopics/completions/seen` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/reviews/{review_id}/complete` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/achievements` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/achievements/seen` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/analytics` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/quizzes/weekly` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/quizzes/weekly/{quiz_id}/attempts` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/quizzes/subtopics/{completion_id}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/quizzes/subtopics/{completion_id}/attempts` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/quizzes/subtopics/{quiz_id}/attempts` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET, PUT | `/v1/me/profile-sharing` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/public-profiles/{token}` | Public visitor / filtered anonymous data | Candidate; local handler/SQL tests |
| GET, PUT | `/v1/me/connections/settings` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/connections` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET, POST | `/v1/me/connections/with/{token}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/connections/with/{token}/block` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/connections/{connection_id}/actions` | Mobile / verified learner | Candidate; local handler/SQL tests |
| DELETE | `/v1/me/connections/blocks/{block_id}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/v1/me/relationships` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET, POST | `/v1/me/relationships/with/{token}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/relationships/with/{token}/block` | Mobile / verified learner | Candidate; shared pair-safe SQL and handler tests |
| DELETE | `/v1/me/relationships/{relationship_id}` | Mobile / verified learner | Candidate; local handler/SQL tests |
| POST | `/v1/me/relationships/{relationship_id}/block` | Mobile / verified learner | Candidate; local handler/SQL tests |
| GET | `/privacy` | Browser / public HTML | #418 web cutover |
| GET | `/confirmed` | Browser / public HTML | #418 web cutover |
| GET | `/reset-password` | Browser / public HTML | #418 web cutover |
| GET | `/p/{token}` | Browser / public HTML | #418 web cutover |

Total: 73 OpenAPI paths plus four HTML paths. This counts paths, not method variants.

## Required contract checks before #416 can close

- Match each method, path, status, JSON shape and CORS behavior against FastAPI.
- Run unauthorized, cross-account, revoked-role/session, and stale MFA cases. Service-role access stays inside Edge Functions or service-only SQL functions.
- Exercise concurrent daily assignment and repeated/offline completion against disposable PostgreSQL. Use profile timezone, never a device-provided date.
- Check signed avatar Storage URLs, upload normalization, private profile choices, and revoked public links.
- Measure latency, response sizes, connection use and Supabase Free usage under a 500 daily-user assumption.

## Cutover ownership

- #416: candidate JSON API, security, SQL migration, parity tests and staging deployment; Railway remains live.
- #417: scheduled workers and jobs, initially disabled.
- #418: browser HTML replacement, app/site URL changes, release gates, production switch, rollback and Railway retirement.

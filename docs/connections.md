# Connections

## Current directed flow

The current Profile → Connections screen keeps a private, one-way list. A learner
scans a friend's profile QR or opens their shared link, then taps **Connect** on
that profile. This adds the friend to the learner's list without notifying or
automatically connecting the friend back. The screen leads with those two entry
paths and shows the list with only the identity/avatar the friend currently
shares. An unavailable profile stays in the private list as **Private learner**
until the owner disconnects or blocks it.

`GET /v1/me/relationships` uses the verified account and bounded keyset
pagination. It returns no email or peer account ID, and only returns an avatar
when the friend's public profile is enabled and **Profile avatar** is selected.
Private photo URLs are short-lived. Avatar Storage outages do not hide the list.
`POST /v1/me/relationships/{relationship-id}/block` lets the list owner block
someone even after that person's public link is revoked; it removes both
directions' entries. Disconnect and block require confirmation in the app, and
offline changes are disabled. Leaving the screen, signing out, or switching
accounts clears the in-memory list.

The mutual request model below documents the earlier flow and its migration;
its request, acceptance, and cooldown controls are not the current Connections
screen.

## Historical mutual request flow

Connections is a complete mutual-consent feature. A signed-in learner opens a
shared profile and explicitly sends a request. Only the recipient can accept or
decline it. The sender can cancel; either connected learner can remove or block.
There are no followers, XP, public rankings, chat or address-book imports.

## Find and connect

Profile → Connections contains the learner's private connections, incoming/sent
requests and blocked list. Turn on **Accept new requests** to receive invitations;
this defaults off. Public profile sharing must also be enabled for someone to use
its current link. A sender also enables sharing, then sees an explanation that
only their selected public details are visible to the recipient.

Open a shared link, paste it into Add a connection, or scan its QR with the phone's
camera. Signed-out visitors are told to sign in and reopen the link; signing in
never sends a request automatically. Requests are visible in the in-app Incoming
requests section; this feature does not add push/email delivery or a paid service.

A previous decline, cancellation or removal starts a seven-day wait before another
request for that pair. Each account can send at most 20 new requests in a rolling
24 hours, and either participant can have at most 100 pending requests. Idempotent
retries are not new invitations. Crossed invitations require explicit acceptance;
they never connect people automatically. Each renewed invitation gets a fresh
action ID, so an old screen cannot answer a later invitation for the same pair.

## Privacy and blocking

All lists and mutations require the verified JWT. Lists contain opaque relationship
IDs, never another account UUID or email. They show only the other learner's
currently shared name/link. Hiding a name or disabling sharing replaces the name
with a neutral label; disabled sharing removes the link too. No social graph is
included in the anonymous profile response. The mobile client does not persist
connection lists; leaving the screen, backgrounding or changing accounts clears
its mounted list state and returning loads it again.

Blocking removes an active relationship and pending requests and prevents new
ones in both directions. Responses to the other account say unavailable rather
than identify a block. Only the blocker can remove their block. Unblocking never
restores the connection. Blocking controls connections, not already-public links:
a person who has a public profile URL can still view its selected fields, including
while signed out. Turn off sharing to revoke a public URL.

## Implementation

Migration `0030_connections.sql` creates backend-only preferences, relationship,
block and bounded per-account request-event tables. All have RLS with no direct
learner policies, foreign keys with deletion cleanup, and appropriate lookup
indexes. Relationships have a canonical ordered user pair, a uniqueness constraint,
valid state checks and an initiator constrained to that pair.

The API takes participant profile locks in a stable order for state changes and
rate checks, preventing duplicated/crossed races and accept-versus-block races.
Current sharing/request preferences are checked on new requests. Private lists use
bounded keyset pagination (25 default, 50 maximum); a fresh reload includes entries
added before a previously used cursor. Visibility comes from the current public
sharing settings rather than a copied name or private profile snapshot.

- `GET/PUT /v1/me/connections/settings`: opt-in requests with version conflict checks.
- `GET /v1/me/connections?kind=accepted|incoming|outgoing|blocked`: private lists.
- `GET/POST /v1/me/connections/with/{public-token}`: current status / explicit request.
- `POST /v1/me/connections/with/{public-token}/block`: block before a relationship.
- `POST /v1/me/connections/{relationship-id}/actions`: accept/decline/cancel/remove/block.
- `DELETE /v1/me/connections/blocks/{block-id}`: owner-only, idempotent unblock.

All private responses prohibit caching. Social writes require an online server
response and are never put into the offline learning queue. Invocation ownership
and response epochs fence account changes. Invitation-specific 429 cooldowns do
not pause unrelated daily-learning requests; backend-wide 503 retry delays still
apply. UI buttons are disabled while mutations are pending and failures stay
retryable without exposing backend details.

## PR dependency and deployment

PR #295 targets `develop` under the repository rules and depends on profile PR
#293. Merge #293 first: the current develop comparison includes the inherited
profile commits. Both can be ready for review while this merge order is preserved. The dedicated Connections diff is the
comparison from `codex/267-complete-profile` to `codex/294-mutual-connections`.
Merging #293 first lets GitHub reduce #295 to Connections alone. Do not merge #295
first; no PR merge is authorized by the implementation task.

Apply migrations 0028 and 0029 from #293, then 0030, before deploying the matching
backend. Run schema verification and staging checks before publishing mobile code.
The production applied ledger is unchanged, and no production operation was
performed. No new secrets, native package or runtime-version change is needed.

## Acceptance coverage and remaining phone checks

Database/API tests cover request ownership, all state transitions, repeated/crossed
requests, anonymous denial, RLS, version conflicts, rates/cooldown expiry, current
public-field filtering, blocking, unblocking and pagination. Mobile tests exercise
account fencing, URL validation and isolation of invitation cooldowns. The mocked
browser acceptance script covers settings failures, explicit request consent,
duplicate prevention, offline failure, cancel/decline/accept/remove/block/unblock,
private lists and enlarged text in both themes at 320px.

Before production publication, use two real staging accounts on Android. Check
request/accept status within Incoming requests, private lists for both
accounts, decline/removal cooldown feedback, hide/revoke a shared name/link,
block/unblock from both sides, sign out during a delayed request, background and
resume, and TalkBack focus/order at large text. Scan a profile QR using the phone
camera and check native sharing/deep-link behavior from #293. These physical-device
checks are not represented by browser automation and remain release work.

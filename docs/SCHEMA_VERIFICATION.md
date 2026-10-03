# Verify the deployed database schema

Issue [#165](https://github.com/Coding-Moves/one-concept/issues/165): a filename
in `backend/migrations/applied.txt` is an operator record, not proof that SQL ran.
The schema verifier compares actual PostgreSQL catalog metadata with the reviewed
`backend/schema/contract.json`. It ignores the ledger when deciding readiness.

## What is checked

The contract covers migration hashes and the application's tables, columns,
constraints, indexes, RLS flags/policies, application functions and triggers,
including the signup trigger on `auth.users`. Missing or changed required objects
fail; unexpected policies on the listed application tables also fail. Additional
unrelated tables/indexes are allowed. New application tables/functions must be
added to the snapshot scope and reviewed when updating the contract.

This proves the covered schema shape, not historical execution of every SQL file.
It does not verify seed contents, data backfills, grants, credentials, worker
execution or mobile behavior. It never applies migrations or copies production
metadata into the expected contract. `/health` remains a connectivity check.

## Run the check

With `DIRECT_URL` already set privately in the environment:

```sh
cd backend
python -m app.workers.schema_check
```

Use a PostgreSQL direct/session connection (normally Supabase session pooler port
5432), not transaction pooler port 6543. `DIRECT_URL` must target the same Supabase
project/database as that service's application `DATABASE_URL`. The command needs
no Gemini or Supabase API keys and does not load `.env`; it reads catalog metadata
in a repeatable-read, read-only transaction with a 10-second statement timeout
and a 45-second overall query/connection budget. Connection failures print only
an exception type, never the DSN/password. Prefer a dedicated account restricted
to the metadata needed by the check; no application table writes are needed.

Success prints `{"schema_ready": true, "errors": []}` and exits 0. Missing schema,
invalid/missing connection configuration, permission errors or connection failure
exit nonzero. A failure must be investigated, not bypassed by editing the ledger
or copying the failing target's schema into the contract.

## One-time Railway setup

After an image containing this verifier is available, configure **each** of the
API, reminders and pool-topup services:

1. Preserve the existing real start command and cron schedule.
2. Verify its private `DIRECT_URL` targets the intended application database.
3. Set **Settings → Deploy → Pre-deploy command** to
   `python -m app.workers.schema_check` (optional platform timeout: 60 seconds).
4. Confirm effective deployment settings and a successful pre-deploy log before
   completing the rollout. A failed check must stop the new deployment.

The Docker image now includes both the contract and immutable migration files.
`backend/railway.json` declares the command for services already consuming that
file. The migrated services may use dashboard configuration; merging this PR
alone cannot enable their dashboard gate. Do not opt new services into legacy
Config as Code or assume the API's settings configure the workers.

Railway's pre-deploy command runs in a separate container and a nonzero result
prevents deployment. This check does not run generation, send reminders, or
change records. Do not remove a working deployment to test failure on production;
use the disposable test database described below.

## Protected GitHub checks and mobile releases

Create a GitHub environment named **`production-schema`**, restrict its deployment
branches to **`main`**, and configure its review protections. Add the environment
secret **`PRODUCTION_SCHEMA_DIRECT_URL`**, targeting the same production database.
Keep it out of repository-level secrets and ordinary PR jobs. Configure this
before the first production release containing the new workflow; without a valid
secret the schema check fails and Release cannot publish OTA or a GitHub release.

- Ordinary PR quality CI runs the contract and drift regressions on disposable
  PostgreSQL 16. It never receives the production connection.
- `migrations.yml` retains the filename ledger check on release PRs. On trusted
  pushes/manual runs of `main`, a direct job enters `production-schema` and
  checks the actual database before reporting the protected result.
- `production-schema.yml` is independently dispatchable on `main` only. It
  checks out the current commit, rejects a stale main revision, and reads the
  environment secret only in the verification step. No checkout-ref input or
  `pull_request_target` workflow permits PR code to run with production access.
- `release.yml` uses its own direct protected job before OTA publication. A
  reusable workflow call did not receive the environment secret during the
  v1.10.3 main push, although direct dispatch succeeded. The existing
  backend-revision attestation still verifies operator intent; the schema gate
  does not independently identify the Git SHA deployed on Railway.

A feature-branch manual dispatch skips the protected job; it is not production
verification. GitHub environment/branch protections and Railway settings require
owner setup; workflow files alone cannot establish those dashboard protections.
The post-merge check does not itself block Railway's independent auto-deploy;
the Railway pre-deploy setting provides that protection.

## Adding a migration and maintaining the contract

1. Add an ordered migration; never rewrite one already applied. Update the
   snapshot's application table/function scope for newly introduced objects.
2. Rebuild the expected contract only against the disposable test database:

   ```sh
   cd backend
   UPDATE_SCHEMA_CONTRACT=1 .venv/bin/python -m pytest -q tests/test_schema_contract.py::test_migrations_produce_reviewed_schema_contract
   .venv/bin/python -m pytest -q tests/test_schema_contract.py tests/test_schema_check.py
   ```

3. Review the contract diff alongside the SQL. Commit both and a meaningful
   regression for the new schema requirement. The fixture always creates a fresh
   local PostgreSQL 16 container; it accepts no production database override.
4. Apply SQL to production through the existing approved manual process, record
   verified application in `applied.txt`, then run the read-only target check.

Tests remove `claimed_at`, required tables and constraints; disable RLS and a
trigger; and add an unsafe policy while leaving `applied.txt` fully populated.
Those cases must fail verification. Connection redaction and actual read-only
transaction settings have separate coverage. Catalog rendering can differ across
PostgreSQL major versions; inspect any mismatch against the intended migration
instead of weakening checks or automatically accepting production drift.

The portable verifier is extracted from draft PR #231; its VM deployment,
SSH, billing, and unrelated app changes remain deferred. When that draft resumes,
reconcile this implementation rather than adding a second verifier.

References: [Railway pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command),
[GitHub reusable workflows and environment secrets](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

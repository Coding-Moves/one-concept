# Legacy enrichment rollout (#352)

Legacy enrichment prepares complete private revisions for existing published
lessons. It does not change what learners see until an authenticated reviewer
approves and publishes an individual revision.

## Release-only database migration

**Do not apply `0042_legacy_enrichment_batches.sql` while developing or testing
this pull request.** Apply it only as part of the release PR that contains the
completed #352 implementation, after the normal staging verification.

The release operator must:

1. Verify the final release PR includes migration `0042`, its matching
   `backend/schema/contract.json` update, and no edit to an already-applied
   migration.
2. Back up the production database using the existing release backup procedure.
3. Apply the migration once with the production migration connection, in order
   after all preceding migrations.
4. Verify the migration transaction succeeded, the two `editorial_legacy_*`
   tables have RLS enabled, and client database roles cannot read either table.
5. Only after that verification, add `0042_legacy_enrichment_batches.sql` to
   `backend/migrations/applied.txt` in the release follow-up commit.
6. Deploy the matching API and workers, keep legacy enrichment paused, and run a
   small private batch before enabling a full subject.

A failed migration or verification means the release stops. Do not mark the
migration as applied, enable generation, or create a legacy batch until it is
repaired and verified.

## Generation-key operations

Use `GEMINI_API_KEY` and `GEMINI_MODEL` only in Railway service variables for
the API and generation workers. Never put a key in the mobile app, repository,
GitHub workflow output, issue, or screenshot. After the five-subject backfill,
rotate back to the normal key or remove the temporary key, pause legacy
processing, and verify every generation-capable Railway service has the final
intended values.

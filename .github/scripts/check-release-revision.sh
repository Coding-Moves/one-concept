#!/usr/bin/env bash
set -euo pipefail
# This validates the attestation; release.yml separately checks the actual VM.
if [[ "${GITHUB_REF:-}" != refs/heads/main ]]; then
  echo '::error::Publish releases from main only.'
  exit 1
fi
if [[ ! "${VERIFIED_BACKEND_SHA:-}" =~ ^[0-9a-f]{40}$ ]] ||
   [[ "$VERIFIED_BACKEND_SHA" != "${GITHUB_SHA:-}" ]] ||
   [[ "$VERIFIED_BACKEND_SHA" != "${REMOTE_MAIN_SHA:-}" ]]; then
  echo '::error::Verify the current main commit on the production API and workers, then provide its full SHA.'
  exit 1
fi

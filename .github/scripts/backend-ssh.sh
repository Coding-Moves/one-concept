#!/usr/bin/env bash
set -euo pipefail
# Only protected main-branch jobs receive these environment secrets.
[[ "${DEPLOY_HOST:-}" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid deployment hostname'; exit 1; }
[[ "${DEPLOY_PORT:-22}" =~ ^[0-9]+$ ]] || exit 1
[[ "${2:-}" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full revision is required'; exit 1; }
case "${1:-}" in
  deploy)
    [[ $# == 3 && "$3" =~ ^ghcr.io/coding-moves/one-concept-backend@sha256:[0-9a-f]{64}$ ]] || exit 1
    ;;
  status) [[ $# == 2 ]] || exit 1 ;;
  *) exit 1 ;;
esac
[[ -n "${DEPLOY_SSH_KEY:-}" && -n "${DEPLOY_KNOWN_HOSTS:-}" ]] || { echo 'Configure the protected deployment key and independently verified host keys'; exit 1; }
umask 077
credential_dir=$(mktemp -d)
trap 'rm -rf "$credential_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$credential_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$credential_dir/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh -T -i "$credential_dir/key" -p "${DEPLOY_PORT:-22}" \
  -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o GlobalKnownHostsFile=/dev/null \
  -o UserKnownHostsFile="$credential_dir/known_hosts" \
  "one-concept-deploy@$DEPLOY_HOST" "$*"

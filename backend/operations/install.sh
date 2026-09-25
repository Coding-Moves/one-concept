#!/usr/bin/env bash
set -euo pipefail
# Run once from the reviewed checkout on a dedicated Ubuntu 24.04 VM.
[[ $EUID -eq 0 ]] || { echo 'Run with sudo'; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Use Ubuntu 24.04 or review the installation for your OS'; exit 1; }
command -v docker >/dev/null
docker compose version >/dev/null
command -v python3 >/dev/null
command -v timedatectl >/dev/null
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
install -d -m 0700 /etc/one-concept /etc/one-concept/imports
install -d -m 0755 /opt/one-concept/bootstrap /opt/one-concept/releases /var/lib/one-concept /var/lib/one-concept/public
# Re-running bootstrap never replaces a running release's controller.
cp -R "$SOURCE/." /opt/one-concept/bootstrap/
chown -R root:root /opt/one-concept/bootstrap
chmod -R go-w /opt/one-concept/bootstrap
if [[ ! -e /opt/one-concept/current ]]; then
  ln -s /opt/one-concept/bootstrap /opt/one-concept/current
fi
cat > /usr/local/sbin/one-concept <<'WRAPPER'
#!/bin/sh
exec /usr/bin/python3 /opt/one-concept/current/manage.py "$@"
WRAPPER
chmod 0755 /usr/local/sbin/one-concept
for file in "$SOURCE"/systemd/*; do install -m 0644 "$file" /etc/systemd/system/; done
systemctl daemon-reload
systemctl enable --now docker
# Keep all schedules off until the old Railway dispatchers are confirmed stopped.
systemctl disable --now one-concept-reminders.timer one-concept-pool_topup.timer one-concept-observe.timer
rm -f /var/lib/one-concept/jobs-enabled
timedatectl set-timezone UTC
timedatectl set-ntp true
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/one-concept.conf <<'JOURNAL'
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=50M
MaxRetentionSec=14day
JOURNAL
systemctl restart systemd-journald
if ! id one-concept-deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh one-concept-deploy
  passwd --lock one-concept-deploy
fi
install -d -m 0700 -o one-concept-deploy -g one-concept-deploy /home/one-concept-deploy/.ssh
# The key is forced to pass one opaque request string into the validating CLI.
cat > /etc/sudoers.d/one-concept-deploy <<'SUDOERS'
one-concept-deploy ALL=(root) NOPASSWD: /usr/local/sbin/one-concept ssh *
SUDOERS
chmod 0440 /etc/sudoers.d/one-concept-deploy
visudo -cf /etc/sudoers.d/one-concept-deploy
printf '%s\n' 'Bootstrap installed. Fill root-only configuration, pin the proxy image, and install the restricted deployment public key using the runbook. No application was deployed and no worker was enabled.'

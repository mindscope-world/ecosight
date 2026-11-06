#!/usr/bin/env bash
# Installs the daily backup for the current user, or removes it with --remove.
# Nothing is installed system-wide and nothing needs root.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [[ "${1:-}" == "--remove" ]]; then
  systemctl --user disable --now ecosight-backup.timer 2>/dev/null || true
  rm -f "$units/ecosight-backup.service" "$units/ecosight-backup.timer" "$units/ecosight-backup-failed.service"
  systemctl --user daemon-reload
  echo "The daily backup is removed. Backups already taken are left where they are."
  exit 0
fi

mkdir -p "$units" "$repo/data/backups"
sed "s#@REPO@#$repo#g" "$repo/infra/backup/ecosight-backup.service" > "$units/ecosight-backup.service"
cp "$repo/infra/backup/ecosight-backup.timer" "$units/ecosight-backup.timer"
cp "$repo/infra/backup/ecosight-backup-failed.service" "$units/ecosight-backup-failed.service"
systemctl --user daemon-reload
systemctl --user enable --now ecosight-backup.timer
echo "Installed. Next run:"
systemctl --user list-timers ecosight-backup.timer --no-pager | sed -n 2p
echo "Run it now with: systemctl --user start ecosight-backup.service"
echo "Remove it with:  $repo/infra/backup/install.sh --remove"

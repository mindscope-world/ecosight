#!/usr/bin/env bash
# Takes a backup and proves it restores. Run by the timer in infra/backup/, or by hand.
# Stops at the first step that fails, so a failure is never followed by a claim of success.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) backup"
pnpm --silent db:backup
# The restore check needs the local server; it is started if it is not running.
pnpm --silent db:up >/dev/null
pnpm --silent db:backup:verify

#!/usr/bin/env bash
# Update Circuit Notebook on the server: fetch the latest code, rebuild, restart, check.
#   ~/circuit-notebook/deploy/update.sh
# Shared projects keep working during the rebuild; the switch to the new version takes a few
# seconds, and open pages reconnect by themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Fetching the latest version"
before=$(git rev-parse --short HEAD)
git pull --ff-only
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  echo "Already up to date ($after). Use --force to rebuild anyway."
  exit 0
fi
git log --oneline "$before..$after" | sed 's/^/   /' || true

echo "→ Saving a copy of the database (backups/, the 5 latest are kept)"
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
# A clean copy made by SQLite itself (only the database: the nightly copies stay in /data).
if docker compose exec -T circuit-notebook node -e "
  const s = require('node:sqlite');
  s.backup(new s.DatabaseSync('/data/circuit-notebook.sqlite'), '/tmp/pre-update.sqlite')
    .then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
" 2>/dev/null &&
  docker compose cp circuit-notebook:/tmp/pre-update.sqlite "backups/cn-$stamp.sqlite" >/dev/null 2>&1; then
  docker compose exec -T circuit-notebook rm -f /tmp/pre-update.sqlite
  echo "   backups/cn-$stamp.sqlite ($(du -h "backups/cn-$stamp.sqlite" | cut -f1))"
  ls -1t backups/cn-*.sqlite | tail -n +6 | xargs -r rm -f
  # Copies of the whole data folder made by earlier versions of this script: keep the newest.
  ls -1dt backups/data-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
else
  echo "   (server not running: no copy)"
fi

echo "→ Building and restarting"
docker compose up -d --build

echo "→ Removing old images and build cache"
docker image prune -f >/dev/null
# Each build leaves ~1 GB in Docker's build cache: keep 3 GB of it, the most recently used
# (the next build stays fast). Older Docker versions: drop what was not used for a day.
docker builder prune -f --keep-storage 3gb >/dev/null 2>&1 ||
  docker builder prune -f --filter until=24h >/dev/null || true

echo "→ Checking"
for _ in $(seq 1 30); do
  if curl -fs localhost:8787/api/health >/dev/null; then
    echo "✓ Circuit Notebook $after is up: https://circuitnotebook.com"
    exit 0
  fi
  sleep 1
done
echo "✗ The server does not answer. Logs: docker compose logs --tail 50" >&2
exit 1

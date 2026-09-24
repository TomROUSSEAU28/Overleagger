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

echo "→ Building and restarting"
docker compose up -d --build

echo "→ Removing old images"
docker image prune -f >/dev/null

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

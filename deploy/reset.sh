#!/usr/bin/env bash
# Start the server again from zero: every account, shared project, friend, team and version
# history is removed (projects saved in browsers are not touched). The old database is only
# moved aside, into the data volume's backups/ folder, so it can be brought back.
#
#   ~/circuit-notebook/deploy/reset.sh --admin you@example.com
#
# --admin EMAIL  also makes EMAIL the administrator (ADMIN_EMAILS in docker-compose.override.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

admin=""
while [ $# -gt 0 ]; do
  case "$1" in
    --admin)
      admin="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done
if [ -n "$admin" ] && ! [[ "$admin" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "“$admin” is not an e-mail address." >&2
  exit 2
fi

# Write ADMIN_EMAILS in the server settings (never in git: this file is ignored).
set_admin() {
  local f=docker-compose.override.yml
  if [ ! -f "$f" ]; then
    printf 'services:\n  circuit-notebook:\n    environment:\n      ADMIN_EMAILS: %s\n' "$1" >"$f"
  elif grep -q '^[[:space:]]*ADMIN_EMAILS:' "$f"; then
    sed -i "s|^\([[:space:]]*\)ADMIN_EMAILS:.*|\1ADMIN_EMAILS: $1|" "$f"
  elif grep -q '^[[:space:]]*environment:[[:space:]]*$' "$f"; then
    awk -v v="$1" '
      { print }
      !done && /^[[:space:]]*environment:[[:space:]]*$/ {
        match($0, /^[[:space:]]*/)
        printf "%s  ADMIN_EMAILS: %s\n", substr($0, 1, RLENGTH), v
        done = 1
      }' "$f" >"$f.tmp"
    mv "$f.tmp" "$f"
  else
    echo "Could not find “environment:” in $f: add “ADMIN_EMAILS: $1” there by hand." >&2
    return 1
  fi
  echo "   ADMIN_EMAILS: $1 (in $f)"
}

echo "This erases everything on the Circuit Notebook server:"
echo "  accounts, shared projects, friends, teams and version history."
echo "Projects saved in browsers are not touched. The old database is kept aside."
read -r -p "Type RESET to continue: " answer
if [ "$answer" != "RESET" ]; then
  echo "Nothing changed."
  exit 1
fi

if [ -n "$admin" ]; then
  echo "→ Administrator"
  set_admin "$admin"
fi

stamp=$(date +%Y%m%d-%H%M%S)
echo "→ Stopping the server"
docker compose stop

echo "→ Moving the old database aside"
docker compose run --rm --no-deps --entrypoint sh circuit-notebook -c "
  set -e
  dir=/data/backups/before-reset-$stamp
  mkdir -p \"\$dir\"
  for f in /data/circuit-notebook.sqlite /data/circuit-notebook.sqlite-wal /data/circuit-notebook.sqlite-shm; do
    if [ -e \"\$f\" ]; then mv \"\$f\" \"\$dir/\"; fi
  done
  echo \"   saved in \$dir\"
"

echo "→ Starting with an empty database"
docker compose up -d --build

echo "→ Checking"
for _ in $(seq 1 30); do
  if curl -fs localhost:8787/api/health >/dev/null; then
    echo "✓ Fresh start done."
    echo
    echo "Next: open the site, create your account${admin:+ with $admin},"
    echo "then your avatar menu → Administration."
    echo
    echo "To undo: docker compose stop, then"
    echo "  docker compose run --rm --entrypoint sh circuit-notebook -c 'mv /data/backups/before-reset-$stamp/* /data/'"
    echo "and docker compose start."
    exit 0
  fi
  sleep 1
done
echo "✗ The server does not answer. Logs: docker compose logs --tail 50" >&2
exit 1

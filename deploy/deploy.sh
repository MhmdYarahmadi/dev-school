#!/usr/bin/env bash
# Build locally and (re)deploy pgschool to the VPS. Usage: deploy/deploy.sh
# First-time setup (the .env with ADMIN_PASSWORD and the Caddy block) is described in deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${PGSCHOOL_HOST:-vps}"
DEST=/opt/stacks/pgschool

echo "▶ testing…";  npm test --silent
echo "▶ building…"; npm run build --silent
echo "▶ uploading to $HOST:$DEST…"
ssh "$HOST" "mkdir -p $DEST"
rsync -az --delete dist/ "$HOST:$DEST/dist/"
rsync -az --delete server/ "$HOST:$DEST/server/"
rsync -az deploy/Dockerfile deploy/docker-compose.yml "$HOST:$DEST/"
ssh "$HOST" "test -f $DEST/.env" || { echo "✗ $DEST/.env is missing (needs ADMIN_PASSWORD). See deploy/README.md"; exit 1; }
echo "▶ restarting container…"
ssh "$HOST" "cd $DEST && docker compose up -d --build --remove-orphans && docker image prune -f >/dev/null"
echo "✓ deployed. Health: $(ssh "$HOST" 'docker exec school-app wget -qO- http://127.0.0.1:8787/api/health')"

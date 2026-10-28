#!/usr/bin/env bash
# Run Dev School on this computer at http://localhost:8787 (e.g. while the VPS is down).
#   bash deploy/local.sh start | stop | status | rebuild
# Accounts and progress live in ~/.local/share/zilber-school (separate from the VPS database).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8787}
DATA=${DATA_DIR:-$HOME/.local/share/zilber-school}
PIDFILE=$DATA/server.pid
LOG=$DATA/server.log
PASSFILE=$HOME/.config/pgschool/admin-password.txt

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-start}" in
  start)
    if running; then echo "Already running: http://localhost:$PORT"; exit 0; fi
    [ -f dist/sw.js ] || { echo "No build yet: run  bash deploy/local.sh rebuild"; exit 1; }
    mkdir -p "$DATA"
    ADMIN_PASSWORD=$(cat "$PASSFILE" 2>/dev/null || true) PORT=$PORT DATA_DIR=$DATA STATIC_DIR=./dist \
      nohup node server/index.mjs >>"$LOG" 2>&1 &
    echo $! >"$PIDFILE"
    for _ in $(seq 1 20); do curl -fs "http://localhost:$PORT/api/health" >/dev/null && break; sleep 0.25; done
    curl -fs "http://localhost:$PORT/api/health" >/dev/null && echo "✓ Dev School: http://localhost:$PORT  (admin: http://localhost:$PORT/admin/)" || { echo "✗ did not start, see $LOG"; exit 1; }
    ;;
  stop)
    if running; then kill "$(cat "$PIDFILE")"; rm -f "$PIDFILE"; echo "Stopped."; else echo "Not running."; fi
    ;;
  status)
    if running; then echo "Running: http://localhost:$PORT (data in $DATA)"; else echo "Not running."; fi
    ;;
  rebuild)
    npm test && npm run build
    if running; then "$0" stop && "$0" start; fi
    ;;
  *)
    echo "usage: bash deploy/local.sh start | stop | status | rebuild"; exit 1
    ;;
esac

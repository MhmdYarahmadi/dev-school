#!/usr/bin/env bash
# Take school.zilber.tech offline (reversible): Caddy serves a "temporarily unavailable" page
# and the school-app container is stopped. No data is deleted. Undo with deploy/school-enable.sh.
set -euo pipefail
HOST="${SCHOOL_HOST:-vps}"
ssh "$HOST" 'set -e; cd /opt/stacks/proxy
B=Caddyfile.bak.$(date +%Y%m%d-%H%M%S); cp Caddyfile "$B"; echo "backup: $B"
python3 - <<"PY"
import re
s = open("Caddyfile").read()
m = re.search(r"school\.zilber\.tech \{\n.*?\n\}\n", s, flags=re.S)
if not m:
    raise SystemExit("school.zilber.tech block not found")
block = m.group(0)
if "temporarily unavailable" in block:
    raise SystemExit("already disabled")
open("school.caddy.enabled", "w").write(block)          # saved for school-enable.sh
off = """school.zilber.tech {
	# DISABLED - restore with deploy/school-enable.sh (original block saved in school.caddy.enabled)
	header Content-Type "text/html; charset=utf-8"
	respond "<!doctype html><title>Zilber School</title><body style=\\"font-family:system-ui;text-align:center;padding:4em\\"><h1>Zilber School</h1><p>The school is temporarily unavailable. Please check back later.</p></body>" 503
}
"""
with open("Caddyfile", "r+") as f:
    f.seek(0); f.write(s.replace(block, off)); f.truncate()
PY
docker cp Caddyfile caddy:/tmp/Caddyfile.current
docker exec caddy caddy validate --config /tmp/Caddyfile.current --adapter caddyfile 2>&1 | grep -q "Valid configuration" || { cp "$B" Caddyfile; echo "INVALID - restored backup"; exit 1; }
docker exec caddy caddy reload --config /tmp/Caddyfile.current --adapter caddyfile >/dev/null 2>&1 && echo "caddy: maintenance page on"
cd /opt/stacks/pgschool && docker compose stop 2>&1 | grep -v "^\s*$" || true'
echo "✓ school.zilber.tech is disabled (data kept). Restore: deploy/school-enable.sh"

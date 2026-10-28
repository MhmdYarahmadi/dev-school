#!/usr/bin/env bash
# Bring school.zilber.tech back after deploy/school-disable.sh.
set -euo pipefail
HOST="${SCHOOL_HOST:-vps}"
ssh "$HOST" 'set -e
cd /opt/stacks/pgschool && docker compose start 2>&1 | grep -v "^\s*$" || true
for i in $(seq 1 20); do docker exec school-app wget -qO- http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 1; done
cd /opt/stacks/proxy
test -f school.caddy.enabled || { echo "no saved block (school.caddy.enabled) - is it disabled?"; exit 1; }
B=Caddyfile.bak.$(date +%Y%m%d-%H%M%S); cp Caddyfile "$B"; echo "backup: $B"
python3 - <<"PY"
import re
s = open("Caddyfile").read()
block = open("school.caddy.enabled").read()
s2, n = re.subn(r"school\.zilber\.tech \{\n.*?\n\}\n", lambda m: block, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit("school.zilber.tech block not found")
with open("Caddyfile", "r+") as f:
    f.seek(0); f.write(s2); f.truncate()
PY
docker cp Caddyfile caddy:/tmp/Caddyfile.current
docker exec caddy caddy validate --config /tmp/Caddyfile.current --adapter caddyfile 2>&1 | grep -q "Valid configuration" || { cp "$B" Caddyfile; echo "INVALID - restored backup"; exit 1; }
docker exec caddy caddy reload --config /tmp/Caddyfile.current --adapter caddyfile >/dev/null 2>&1 && echo "caddy: site routing restored"
rm school.caddy.enabled'
echo "✓ school.zilber.tech is back: $(curl -s -m 15 -o /dev/null -w '%{http_code}' https://school.zilber.tech/api/health)"

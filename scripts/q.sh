#!/bin/sh
# Usage: scripts/q.sh "SQL1|||SQL2" : runs queries against the seeded bookstore DB
cd "$(dirname "$0")/.." && Q="$1" npx vitest run --config scripts/vitest.config.ts scripts/q.test.ts --silent=false 2>&1 | grep -v -E "^\s*$|RUN|Test Files|Tests |Start at|Duration|✓|stdout"

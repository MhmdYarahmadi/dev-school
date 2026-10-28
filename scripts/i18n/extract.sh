#!/bin/sh
# Rewrites src/i18n/ui.en.json and src/i18n/git.en.json from the code and the Git course content.
cd "$(dirname "$0")/../.." && node_modules/.bin/vitest run --config scripts/vitest.config.ts scripts/i18n-extract.test.ts

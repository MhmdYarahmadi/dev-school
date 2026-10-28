import { defineConfig } from 'vitest/config';
// Only used by scripts/q.sh (ad-hoc queries against the seed DB).
export default defineConfig({ test: { include: ['scripts/*.test.ts'], testTimeout: 60000 } });

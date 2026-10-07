import { loadEnvFile } from 'node:process';
import { defineConfig } from 'vitest/config';

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // CI provides DATABASE_URL directly.
}
// Tests assert on the synthetic sample, so they use their own database when one is set.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// The files share one database and some tests change a record for a moment, so they run one after another.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], fileParallelism: false } });

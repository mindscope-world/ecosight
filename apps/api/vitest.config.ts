import { loadEnvFile } from 'node:process';
import { defineConfig } from 'vitest/config';

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // CI provides DATABASE_URL directly.
}

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });

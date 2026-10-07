import { loadEnvFile } from 'node:process';
import { defineConfig } from '@playwright/test';

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // CI provides DATABASE_URL directly.
}

// The tests assert on the synthetic sample, so the API they drive reads the test
// database when one is set, and the seeded database otherwise (as in CI).
const database = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!database) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to a seeded database');

// Ports of their own, so a development server left running does not get in the way.
const API_PORT = '4190';
const WEB_PORT = '5290';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // The Chrome already on the machine, which GitHub's runners also carry: nothing to download.
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @atlas/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/health`,
      // No access key: the tests drive the open API, whatever a local .env sets for deployment.
      // DEV_USER: every request is the sample's reviewer, so the review queue can be driven without a real sign-in.
      env: {
        DATABASE_URL: database,
        PORT: API_PORT,
        RATE_LIMIT_PER_MINUTE: '100000',
        ACCESS_KEY: '',
        DEV_USER: 'reviewer@example.org',
        SUPABASE_URL: '',
      },
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: 'pnpm exec vite',
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT, WEB_PORT, VITE_DATA_URL: '', VITE_API_URL: '/api' },
      reuseExistingServer: false,
      // The dev server echoes the browser's console, including the basemap the tests block on purpose.
      stdout: 'ignore',
    },
  ],
});

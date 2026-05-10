import { defineConfig, devices } from '@playwright/test';

/**
 * Golden-path E2E config. The runner expects a fully wired environment:
 *
 *   1. `docker compose up -d`             — Mongo + Redis + MinIO
 *   2. `cd backend && pnpm seed && pnpm start:dev`   — :4000 with admin user
 *   3. `cd frontend && pnpm dev`          — :5173
 *
 * Then in another terminal:
 *
 *   cd frontend
 *   pnpm test:e2e:install   # one-time browser download
 *   pnpm test:e2e
 *
 * Override the URLs via E2E_BASE_URL / E2E_API_URL when running against a
 * staging deployment.
 */
const FE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  // The golden-path test mutates DB state (creates a patient, books an
  // appointment, etc.) — running suites in parallel against the same
  // backend would race on the seeded admin / bill counters.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

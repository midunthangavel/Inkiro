import { defineConfig, devices } from '@playwright/test';

/**
 * Shop Dashboard E2E config.
 *
 * Pre-req: the Inkiro backend must be running on :3000 with the seed data loaded
 * (seed shop `9876540002`, OTP `123456` in dev mode). Playwright will auto-start
 * the Vite dev server; the backend is treated as an external dependency.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect:  { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries:  process.env.CI ? 2 : 0,
  workers:  process.env.CI ? 1 : undefined,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace:   'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev',
    url:     'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

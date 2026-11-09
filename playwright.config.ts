import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: production build + `next start` against the TEST database (migrated & seeded
 * by the web server command). Only Chromium is installed in CI/dev containers, so
 * every device profile is forced onto Chromium (viewport, DPR, touch, UA kept).
 *
 *   npm run test:e2e                                   # all projects
 *   npx playwright test --project=iphone-se --project=ipad-mini --project=desktop
 *   E2E_SKIP_BUILD=1 npx playwright test ...           # reuse an existing .next build
 */
const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/doom_test';
const chromium = { browserName: 'chromium' as const, defaultBrowserType: 'chromium' as const };

const build = process.env.E2E_SKIP_BUILD ? '' : 'npm run build && ';
/** Point at an already running server (e.g. a module dev server) with BASE_URL=http://localhost:3101 — no webServer is started then. */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  // Test-only storefront products (created after the server is up, removed at the end).
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Muscat',
  },
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], ...chromium } },
    { name: 'iphone-15', use: { ...devices['iPhone 15'], ...chromium } },
    { name: 'iphone-15-pro-max', use: { ...devices['iPhone 15 Pro Max'], ...chromium } },
    { name: 'galaxy-s9plus', use: { ...devices['Galaxy S9+'], ...chromium } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'ipad-mini', use: { ...devices['iPad Mini'], ...chromium } },
    { name: 'galaxy-tab-s4', use: { ...devices['Galaxy Tab S4'], ...chromium } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'wide', use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } } },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: `npx prisma migrate deploy && npm run db:seed && ${build}npm run start`,
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: 'pipe',
    env: {
      DATABASE_URL: TEST_DB,
      ENABLE_UI_KIT: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});

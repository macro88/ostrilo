import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "list",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace on first retry of each failed test. */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  /* Configure web server for E2E tests */
  webServer: {
    command: 'npx http-server tests/e2e/fixtures -p 8765',
    port: 8765,
    reuseExistingServer: !process.env.CI,
  },

  /* Configure projects for major browsers */
  projects: [
    // Generic desktop browsers for non-extension tests
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // Chromium project configured for extension tests (requires headed)
    {
      name: "chromium-extension",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], headless: false },
    },
  ],
});

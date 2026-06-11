import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results/e2e",
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
    command: "pnpm exec http-server tests/e2e/fixtures -a 127.0.0.1 -p 8765",
    port: 8765,
    reuseExistingServer: !process.env.CI,
  },

  /* Extension E2E tests require Chromium with a persistent extension context. */
  projects: [
    {
      name: "chromium-extension",
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
  ],
});

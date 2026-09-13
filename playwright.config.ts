import { defineConfig, devices } from "@playwright/test";
import { ensureDevCertificate } from "./tests/e2e/fixtures/make-dev-cert";

// The NIP-07 content script matches https:// only, so the fixture page must
// be served over TLS or window.nostr is never injected and every provider
// test fails for a reason unrelated to what it is testing. The certificate
// is throwaway, regenerated into test-results/ and trusted by nothing
// outside the test browser.
const { cert, key } = ensureDevCertificate();

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
    command: `pnpm exec http-server tests/e2e/fixtures -a 127.0.0.1 -p 8765 -S -C "${cert}" -K "${key}"`,
    url: "https://localhost:8765/test-page.html",
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
  },

  /* Extension E2E tests require Chromium with a persistent extension context. */
  projects: [
    {
      name: "chromium-extension",
      testMatch: /.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        ignoreHTTPSErrors: true,
      },
    },
  ],
});

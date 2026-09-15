/**
 * Starting point for a disposable driving session. See docs/agent-loop.md.
 *
 *   cp tests/e2e/fixtures/scratch-template.ts tests/e2e/loop.scratch.spec.ts
 *   pnpm run agent:loop 2>&1 | tail -40
 *
 * Scratch specs are gitignored and CI never runs them. Promote anything worth
 * keeping into a real `tests/e2e/<feature>.spec.ts`.
 *
 * Artifacts land in test-results/agent/agent-scratch/<test-slug>/: the PNGs,
 * plus console.log carrying page and service-worker output.
 *
 * `await page.pause()` stops the run with the browser open and Playwright
 * Inspector attached, which is how a human takes over mid-session.
 *
 * This file is type-checked but never executed: it does not match either
 * project's testMatch until it is copied to a *.scratch.spec.ts name.
 */
import { test, expect } from "./extension";
import { captureStepScreenshot } from "./screenshots";
import { seedUnlockedVault, openDapp, grantKindAllow, DAPP_ORIGIN } from "./agent";

test("scratch", async ({ openPopup, extensionContext }, testInfo) => {
  const popup = await openPopup();
  await seedUnlockedVault(popup);
  await captureStepScreenshot(popup, testInfo, "01-home");

  await grantKindAllow(popup, DAPP_ORIGIN, 1);

  const dapp = await openDapp(extensionContext);
  const pubkey = await dapp.evaluate(() => window.testGetPublicKey());
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
  await captureStepScreenshot(dapp, testInfo, "02-dapp");
});

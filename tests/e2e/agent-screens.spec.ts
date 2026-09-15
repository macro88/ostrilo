/**
 * Answers "what does the extension look like right now" in one command:
 *
 *   pnpm run agent:screens
 *
 * No assertions beyond what is needed to know a surface finished rendering.
 * Most visual questions are this question, and it should cost one command
 * rather than a spec edit and a build.
 *
 * Run by the agent-scratch project only; the project CI pins ignores this file.
 * Screenshots taken here come from the agent build, which is unminified and
 * keeps its logs — use `pnpm run agent:loop:prod` for anything judged as UI.
 */
import { test } from "./fixtures/extension";
import { captureStepScreenshot } from "./fixtures/screenshots";
import { seedUnlockedVault } from "./fixtures/agent";

test("current surfaces", async ({
  openPopup,
  openOptions,
  openSidepanel,
}, testInfo) => {
  const popup = await openPopup();
  await seedUnlockedVault(popup);
  await captureStepScreenshot(popup, testInfo, "01-popup-home");

  await popup.getByRole("button", { name: "Activity" }).click();
  await captureStepScreenshot(popup, testInfo, "02-popup-activity");

  await popup.getByRole("button", { name: "Settings" }).click();
  await captureStepScreenshot(popup, testInfo, "03-popup-settings");

  const sidepanel = await openSidepanel();
  await sidepanel.setViewportSize({ width: 520, height: 700 });
  await captureStepScreenshot(sidepanel, testInfo, "04-sidepanel");

  const options = await openOptions();
  await options.setViewportSize({ width: 1280, height: 900 });
  await captureStepScreenshot(options, testInfo, "05-options");
});

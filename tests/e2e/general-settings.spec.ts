import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc } from "./fixtures/agent";

/**
 * Theme and the popup/side-panel choice.
 *
 * Neither is password-gated, and neither should be: they change where the
 * extension opens and what colour it is, not what it will sign. They are worth
 * a browser test for a different reason — both are read by contexts other than
 * the one that set them. The theme is applied by `useTheme` in every document,
 * and `sidePanel` decides where the background sends an approval request. A
 * setting that saves but does not propagate leaves the user looking at one
 * surface while the extension behaves according to another.
 */

async function openGeneralTab(page: Page) {
  await page.getByRole("tab", { name: "General" }).click();
  await expect(
    page.getByRole("heading", { name: "General Settings" })
  ).toBeVisible();
}

async function settings(page: Page) {
  return await sendExtensionRpc<{ theme: string; sidePanel: boolean }>(page, {
    type: "settings.get",
  });
}

test.describe("general settings", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("changing the theme persists and applies to the document", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openGeneralTab(options);

    await options.getByLabel("Theme").click();
    await options.getByRole("option", { name: "Dark" }).click();

    await expect.poll(async () => (await settings(options)).theme).toBe("dark");

    // The stored value is only half the claim; the document has to actually
    // wear it, or the setting is decorative.
    await expect
      .poll(async () =>
        options.evaluate(() =>
          document.documentElement.classList.contains("dark")
        )
      )
      .toBe(true);

    await options.getByLabel("Theme").click();
    await options.getByRole("option", { name: "Light" }).click();
    await expect.poll(async () => (await settings(options)).theme).toBe("light");
    await expect
      .poll(async () =>
        options.evaluate(() =>
          document.documentElement.classList.contains("dark")
        )
      )
      .toBe(false);
  });

  /**
   * The popup is a separate document from the options page. A theme changed in
   * one has to reach the other, because the settings model is shared storage
   * and not per-document state.
   */
  test("a theme change reaches an already-open popup", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openGeneralTab(options);

    await options.getByLabel("Theme").click();
    await options.getByRole("option", { name: "Dark" }).click();
    await expect.poll(async () => (await settings(options)).theme).toBe("dark");

    await expect
      .poll(async () =>
        popup.evaluate(() =>
          document.documentElement.classList.contains("dark")
        )
      )
      .toBe(true);
  });

  /**
   * Selecting "Side Panel" is NOT driven through the UI here, and the omission
   * is deliberate rather than an oversight.
   *
   * `OpenInSelector.handleModeChange` calls `enableDocking(true)`, which calls
   * `chrome.sidePanel.open()`. That API must run inside a real user gesture in
   * a window that can host a panel; invoked from an options tab in this harness
   * it takes the options page down with it, with nothing written to the console
   * from either the page or the service worker. So a test that clicked it would
   * be asserting against a harness artifact, not a user-visible behaviour.
   *
   * What matters downstream is the stored flag: `background.ts` reads
   * `settings.sidePanel` to decide whether an approval request opens a window
   * or a panel. That is asserted here, in both directions, and the selector is
   * asserted to render the stored choice.
   *
   * Not covered anywhere, and worth knowing: whether the options tab also
   * closes in a real browser. If it does, that is a UX defect rather than a
   * harness one.
   */
  test("renders and persists the open-in choice", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openGeneralTab(options);

    expect((await settings(options)).sidePanel).toBe(false);
    await expect(options.getByLabel("Open extension in:")).toContainText("Popup");

    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { sidePanel: true },
    });
    await expect.poll(async () => (await settings(options)).sidePanel).toBe(true);

    // The control reflects the stored value rather than its own local state.
    await options.reload();
    await openGeneralTab(options);
    await expect(options.getByLabel("Open extension in:")).toContainText(
      "Side Panel"
    );

    // Returning to the popup goes through the UI: that path calls
    // `disableDocking()`, which does not open a panel.
    await options.getByLabel("Open extension in:").click();
    await options.getByRole("option", { name: "Popup" }).click();
    await expect.poll(async () => (await settings(options)).sidePanel).toBe(false);
  });

  test("settings survive reopening the options page", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openGeneralTab(options);

    await options.getByLabel("Theme").click();
    await options.getByRole("option", { name: "Dark" }).click();
    await expect.poll(async () => (await settings(options)).theme).toBe("dark");

    await options.reload();
    await openGeneralTab(options);

    expect((await settings(options)).theme).toBe("dark");
    await expect(options.getByLabel("Theme")).toContainText("Dark");
  });
});

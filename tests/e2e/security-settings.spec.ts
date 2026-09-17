import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";

/**
 * Auto-lock and session lifetime, driven through the options UI.
 *
 * Both settings decide how long an unlocked vault stays unlocked, so both are
 * password-gated in the background (`reauth.ts` lists `autoLockMinutes` and
 * `sessionTTLMinutes`). That gate is the thing worth a browser test: an
 * attacker with brief physical access to an unlocked browser should not be able
 * to widen the auto-lock window and walk away, because the next time the owner
 * unlocks, a silent-signing origin would have far longer to act.
 *
 * `tests/security/auto-lock.test.ts` and `tests/security/reauth-boundary.test.ts`
 * already prove the rule at the service and RPC layers. These assert the UI
 * actually routes through it rather than writing the setting directly.
 */

const AUTO_LOCK_LABEL = "Auto-lock timeout";

async function openSecurityTab(page: Page) {
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(
    page.getByRole("heading", { name: "Security", exact: true })
  ).toBeVisible();
}

async function currentSettings(page: Page) {
  return await sendExtensionRpc<{
    autoLockMinutes: number;
    sessionTTLMinutes: number;
  }>(page, { type: "settings.get" });
}

async function openOptionsOnSecurity(
  openPopup: () => Promise<Page>,
  openOptions: () => Promise<Page>
) {
  const popup = await openPopup();
  await seedUnlockedVault(popup);

  const options = await openOptions();
  await options.setViewportSize({ width: 1280, height: 900 });
  await openSecurityTab(options);
  return { popup, options };
}

test.describe("security settings", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("asks for the password before widening the auto-lock window", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await expect(slider).toBeVisible();
    await slider.focus();
    await slider.press("ArrowRight");

    // The gate is a dialog, not a silent write.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();

    // Nothing is persisted while the dialog is still open and unanswered.
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  test("applies the change once the password is given", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await options.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(async () => (await currentSettings(options)).autoLockMinutes)
      .not.toBe(before);
  });

  /**
   * The password is verified by decrypting real key material and is never
   * cached, so a wrong answer must leave the setting exactly as it was.
   */
  test("leaves the setting alone when the password is wrong", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await options
      .getByLabel("Password", { exact: true })
      .fill("not-the-right-password");
    await options.getByRole("button", { name: "Confirm" }).click();

    // Give the failed attempt time to land rather than asserting on a race.
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  test("cancelling the password prompt discards the change", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);
    const before = (await currentSettings(options)).autoLockMinutes;

    const slider = options.getByRole("slider", { name: AUTO_LOCK_LABEL });
    await slider.focus();
    await slider.press("ArrowRight");

    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();
    await options.getByRole("button", { name: "Cancel" }).click();

    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toHaveCount(0);
    expect((await currentSettings(options)).autoLockMinutes).toBe(before);
  });

  /**
   * Reset rewrites both timeouts, so it carries the same password gate. It used
   * to ask with `confirm()` and then send the patch bare: the background refused
   * it, nothing reset, and the only trace was a console.error that production
   * compiles away. A destructive button that silently does nothing is worse than
   * one that fails loudly, because the user believes it worked.
   */
  test("resets settings only after the password is given", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { theme: "dark" },
    });
    await expect
      .poll(async () =>
        (await sendExtensionRpc<{ theme: string }>(options, { type: "settings.get" }))
          .theme
      )
      .toBe("dark");

    await options.getByRole("button", { name: "Reset All Settings" }).click();
    await expect(
      options.getByRole("heading", { name: "Confirm with your password" })
    ).toBeVisible();

    await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
    await options.getByRole("button", { name: "Confirm" }).click();

    await expect
      .poll(async () =>
        (await sendExtensionRpc<{ theme: string }>(options, { type: "settings.get" }))
          .theme
      )
      .not.toBe("dark");
  });

  test("cancelling reset changes nothing", async ({ openPopup, openOptions }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { theme: "dark" },
    });

    await options.getByRole("button", { name: "Reset All Settings" }).click();
    await options.getByRole("button", { name: "Cancel" }).click();

    const after = await sendExtensionRpc<{ theme: string }>(options, {
      type: "settings.get",
    });
    expect(after.theme).toBe("dark");
  });

  /**
   * Neither action exists, and neither is shown. Disabled "Change Password"
   * and "Export Private Key" buttons used to sit here as placeholders; a
   * half-built "Export Private Key" that appeared to work would be the worst
   * possible bug in this product, and a dead button is a promise the surface
   * cannot keep. If either ever arrives it must bring its own tests, and this
   * failing is the reminder.
   */
  test("does not offer password change or key export yet", async ({
    openPopup,
    openOptions,
  }) => {
    const { options } = await openOptionsOnSecurity(openPopup, openOptions);

    await expect(
      options.getByRole("button", { name: "Change Password" })
    ).toHaveCount(0);
    await expect(
      options.getByRole("button", { name: "Export Private Key" })
    ).toHaveCount(0);
  });
});

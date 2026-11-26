import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";
import { addVirtualAuthenticator } from "./fixtures/webauthn";

/**
 * Device unlock, end to end, against a VIRTUAL authenticator.
 *
 * Read the caveat in `fixtures/webauthn.ts` before trusting this file for more
 * than it shows. It proves the extension's own path: the Security tab enrols
 * through the password dialog, the lock screen offers the factor only when it
 * would work, and the unlock document opens the vault and records how. It does
 * not prove the production relying-party identifier or any real provider.
 */

type LockState = { isLocked: boolean; authFactor?: string };
type Status = { enrolled: boolean; passwordNeeded?: string };

const lockState = (page: Page) =>
  sendExtensionRpc<LockState>(page, { type: "state.getLock" });
const status = (page: Page) =>
  sendExtensionRpc<Status>(page, { type: "vault.biometricStatus" });

async function enrolThroughSettings(options: Page) {
  await options.getByRole("tab", { name: "Security" }).click();
  await options.getByRole("button", { name: "Turn on" }).click();
  await expect(
    options.getByRole("heading", { name: "Confirm with your password" })
  ).toBeVisible();
  await options.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await options.getByRole("button", { name: "Confirm" }).click();
  await expect(options.getByText("Device unlock is on")).toBeVisible();
}

test.describe("device unlock", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("enrols through the password dialog, then unlocks without the password", async ({
    extensionContext,
    extensionId,
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await addVirtualAuthenticator(extensionContext, options);

    expect((await status(options)).enrolled).toBe(false);
    await enrolThroughSettings(options);
    expect(await status(options)).toMatchObject({ enrolled: true });

    await sendExtensionRpc(options, { type: "vault.lock" });
    expect((await lockState(popup)).isLocked).toBe(true);

    // The lock screen offers the factor, because it would work.
    const locked = await openPopup();
    await expect(
      locked.getByRole("button", { name: "Unlock with your device" })
    ).toBeVisible();

    // The unlock document runs the ceremony on load and opens the vault.
    await options
      .goto(`chrome-extension://${extensionId}/unlock.html`)
      .catch(() => undefined);
    await expect
      .poll(async () => (await lockState(popup)).isLocked)
      .toBe(false);
    expect((await lockState(popup)).authFactor).toBe("biometric");
  });

  test("turning it off needs no password and removes the lock-screen button", async ({
    extensionContext,
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await addVirtualAuthenticator(extensionContext, options);
    await enrolThroughSettings(options);

    await options.getByRole("button", { name: "Turn off" }).click();
    await expect(options.getByRole("button", { name: "Turn on" })).toBeVisible();
    expect((await status(options)).enrolled).toBe(false);

    await sendExtensionRpc(options, { type: "vault.lock" });
    const locked = await openPopup();
    await expect(locked.getByRole("button", { name: "Unlock", exact: true })).toBeVisible();
    await expect(
      locked.getByRole("button", { name: "Unlock with your device" })
    ).toHaveCount(0);
  });

  test("a cancelled ceremony unlocks nothing and says so", async ({
    extensionContext,
    extensionId,
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await addVirtualAuthenticator(extensionContext, options);
    await enrolThroughSettings(options);
    await sendExtensionRpc(options, { type: "vault.lock" });

    // A fresh page has no authenticator holding the credential, which is what
    // a deleted passkey looks like from the extension's side.
    const unlock = await extensionContext.newPage();
    await addVirtualAuthenticator(extensionContext, unlock);
    await unlock.goto(`chrome-extension://${extensionId}/unlock.html`);

    await expect(
      unlock.getByRole("heading", { name: "Nothing was unlocked" })
    ).toBeVisible();
    await expect(unlock.getByRole("button", { name: "Try again" })).toBeVisible();
    expect((await lockState(popup)).isLocked).toBe(true);
  });
});

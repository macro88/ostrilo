import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";

/**
 * The public-key surface: the npub shown on the home screen, its copy action,
 * and the QR modal.
 *
 * This is the one place the extension deliberately puts key material on screen
 * and into the clipboard, which makes it the one place a confusion between the
 * public and the private key would be catastrophic and invisible. The nsec and
 * the npub are both bech32 strings of similar shape; nothing but correctness of
 * this code stops the wrong one being rendered into a QR code that a user then
 * photographs and posts.
 *
 * `tests/security/qr-public-key-only.test.tsx` asserts the same property at the
 * component level. This asserts it of the real rendered extension, against a
 * vault whose actual nsec is known to the test, so "the private key is absent"
 * is checked against the specific string rather than against a pattern.
 */

const NSEC_PATTERN = /nsec1[02-9ac-hj-np-z]{20,}/i;

async function revealNsec(popup: Page): Promise<string> {
  const keys = await sendExtensionRpc<Array<{ id: string }>>(popup, {
    type: "keys.list",
  });
  const revealed = await sendExtensionRpc<{ nsec?: string; privateKey?: string }>(
    popup,
    { type: "vault.reveal", keyId: keys[0].id, password: TEST_PASSWORD }
  );
  const nsec = revealed.nsec ?? revealed.privateKey;
  expect(nsec, "vault.reveal returned no key material").toBeTruthy();
  expect(nsec).toMatch(/^nsec1/);
  return nsec as string;
}

test.describe("public key display", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("shows the npub and never the nsec on the home screen", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const display = popup.getByLabel("Public key display");
    await expect(display).toBeVisible();
    await expect(display).toContainText(/npub1/);

    const nsec = await revealNsec(popup);
    const body = (await popup.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain(nsec.toLowerCase());
    expect(body).not.toMatch(NSEC_PATTERN);
  });

  test("the QR modal encodes the public key and nothing else", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const nsec = await revealNsec(popup);

    await popup.getByRole("button", { name: "Show QR code" }).click();

    const dialog = popup.locator("dialog[aria-modal='true']");
    await expect(dialog).toBeVisible();
    await expect(popup.getByText("Public Key", { exact: true })).toBeVisible();

    // The QR is an SVG, so the encoded payload is not readable as text. What is
    // assertable, and what actually matters, is that the private key is nowhere
    // in the modal's markup — not in the SVG, not in a data attribute, not in a
    // title element.
    const markup = await dialog.innerHTML();
    expect(markup.toLowerCase()).not.toContain(nsec.toLowerCase());
    expect(markup).not.toMatch(NSEC_PATTERN);

    // And the QR really did render, rather than silently failing to and leaving
    // the assertions above passing against an empty modal. `svg[role="img"]` is
    // the code itself; the dialog's other svg is the close icon.
    await expect(dialog.locator('svg[role="img"]')).toBeVisible();

    await popup.getByRole("button", { name: "Close QR code" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("copies the public key, not the private one", async ({
    openPopup,
    extensionContext,
  }) => {
    await extensionContext.grantPermissions(["clipboard-read", "clipboard-write"]);

    const popup = await openPopup();
    await seedUnlockedVault(popup);
    const nsec = await revealNsec(popup);

    await popup.getByRole("button", { name: "Copy public key" }).click();
    await expect(popup.getByText("Copied")).toBeVisible();

    const clipboard = await popup.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toMatch(/^npub1/);
    expect(clipboard).not.toBe(nsec);
    expect(clipboard).not.toMatch(NSEC_PATTERN);
  });

  /**
   * The displayed key must belong to the key the user believes is active. A
   * stale npub after a switch would have someone hand out an identity they did
   * not mean to.
   */
  test("shows the active key's npub after switching keys", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const first = await popup.getByLabel("Public key display").innerText();

    await sendExtensionRpc(popup, {
      type: "vault.generate",
      password: TEST_PASSWORD,
      label: "Second Key",
    });
    const keys = await sendExtensionRpc<Array<{ id: string }>>(popup, {
      type: "keys.list",
    });
    expect(keys.length).toBeGreaterThan(1);

    await sendExtensionRpc(popup, { type: "vault.select", id: keys[1].id });
    await popup.reload();

    await expect
      .poll(async () => await popup.getByLabel("Public key display").innerText())
      .not.toBe(first);
    await expect(popup.getByLabel("Public key display")).toContainText(/npub1/);
  });
});

import { test, expect } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";

/**
 * The identity a user had before a lock is the identity they get after the
 * next unlock, including when the surface they unlock on was opened while the
 * vault was already locked.
 *
 * That last case is the shipped defect: a surface opened locked is handed
 * identifiers only, and used to keep them after the unlock. The header then
 * read "Unnamed" and the Public Key card said the stored key could not be read,
 * over a vault that was healthy. The assertions here are on what the surface
 * renders, because every RPC answer was already correct.
 */

const LABEL = "Restore E2E Key";

interface StoredKey {
  id: string;
  label: string;
  pubkey: string;
  npub: string;
}

test.describe("identity after unlock", () => {
  test("a popup opened while locked shows the same name and public key once unlocked", async ({
    openPopup,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const first = await openPopup();
    await seedUnlockedVault(first, { label: LABEL });
    const [before] = await sendExtensionRpc<StoredKey[]>(first, { type: "keys.list" });
    expect(before.npub).toMatch(/^npub1/);

    await sendExtensionRpc(first, { type: "vault.lock" });

    // A new surface, opened cold while locked: its first key list is redacted.
    const reopened = await first.context().newPage();
    await reopened.goto(first.url());
    const field = reopened.getByLabel(/master password/i).first();
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill(TEST_PASSWORD);
    await reopened.getByRole("button", { name: "Unlock" }).click();

    await expect(
      reopened.getByRole("heading", { level: 2, name: LABEL })
    ).toBeVisible({ timeout: 15_000 });
    const card = reopened.locator('section[aria-label="Active identity"]');
    await expect(card).toContainText(`${before.npub.slice(0, 8)}…${before.npub.slice(-6)}`);

    const body = (await reopened.textContent("body")) ?? "";
    expect(body).not.toContain("could not be read");
    expect(body).not.toContain("Unnamed");

    const [after] = await sendExtensionRpc<StoredKey[]>(reopened, { type: "keys.list" });
    expect(after).toEqual(before);
  });

  test("a surface left open while locked picks the identity up when another surface unlocks", async ({
    openPopup,
    openOptions,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: LABEL });
    const [before] = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    await sendExtensionRpc(popup, { type: "vault.lock" });

    const options = await openOptions();
    await expect(options.getByLabel(/master password/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Unlocked behind the options page's back; it learns from its poll.
    await sendExtensionRpc(popup, { type: "vault.unlock", password: TEST_PASSWORD });

    await expect(
      options.getByRole("heading", { name: "Ostrilo Settings" })
    ).toBeVisible({ timeout: 15_000 });
    await options.getByRole("tab", { name: /keys/i }).first().click();
    await expect(options.getByText(LABEL).first()).toBeVisible();
    await expect(options.getByText(before.npub.slice(0, 8)).first()).toBeVisible();
    expect((await options.textContent("body")) ?? "").not.toContain("Unreadable record");
  });
});

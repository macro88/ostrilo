import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { seedUnlockedVault, sendExtensionRpc } from "./fixtures/agent";

/**
 * Quick start: a password and one key, with the backup left for later.
 *
 * The serial group is one story across two browser profiles. The first profile
 * takes Quick start, keeps the identity through a lock, backs it up from the
 * Home banner, and writes the file. The second restores that file and must end
 * up with the same public key: a backup that restores some other identity is
 * worse than none.
 */

const PASSWORD = "Gannet-Cormorant-Tern-2026!";
const BACKUP_PASSPHRASE = "Skerry-Stack-Kelp-Basalt-2026!";
const KEY_LABEL = "My Nostr Key";
const NSEC_PATTERN = /nsec1[02-9ac-hj-np-z]{20,}/i;
const NOTICE =
  "This creates a new identity on this browser. You can back it up later. If you lose access to this browser before making a backup, you may lose access to this identity.";

interface StoredKey {
  id: string;
  label: string;
  pubkey: string;
  npub: string;
}

async function takeQuickStart(popup: Page): Promise<void> {
  await popup.setViewportSize({ width: 390, height: 700 });
  await expect(
    popup.getByRole("heading", { name: "Welcome to Ostrilo" })
  ).toBeVisible();
  await popup.getByText("Quick start", { exact: true }).click();
  await expect(popup.getByRole("heading", { name: "Quick start" })).toBeVisible();

  await popup.getByLabel("Master Password").fill(PASSWORD);
  await popup.getByLabel("Confirm Password").fill(PASSWORD);
  await popup.getByRole("button", { name: "Create identity" }).click();

  await expect(
    popup.getByRole("heading", { name: "Your identity is ready" })
  ).toBeVisible({ timeout: 20_000 });
  await expect(popup.getByRole("note")).toHaveText(NOTICE);
  await popup.getByRole("button", { name: "Continue" }).click();
  await expect(
    popup.getByRole("heading", { level: 2, name: KEY_LABEL })
  ).toBeVisible({ timeout: 20_000 });
}

const banner = (page: Page) => page.getByRole("region", { name: "Backup reminder" });

test.describe("Quick start", () => {
  test.describe.configure({ mode: "serial" });

  let dir: string;
  let backupPath: string;
  let quickPubkey: string;

  test.beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ostrilo-quick-start-"));
    backupPath = path.join(dir, "quick-start-backup.json");
  });

  test.afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("lands on Home with a no-backup banner, and keeps the identity across a lock", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await takeQuickStart(popup);

    await expect(banner(popup)).toContainText("This key has no backup");
    await expect(popup.getByText("Quick start", { exact: true })).toHaveCount(0);

    const keys = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    expect(keys).toHaveLength(1);
    expect(keys[0].label).toBe(KEY_LABEL);
    quickPubkey = keys[0].pubkey;
    const { statuses } = await sendExtensionRpc<{
      statuses: Array<{ keyId: string; state: string }>;
    }>(popup, { type: "backup.list" });
    expect(statuses).toEqual([
      expect.objectContaining({ keyId: keys[0].id, state: "pending" }),
    ]);

    // No secret was shown on the way in.
    expect((await popup.textContent("body")) ?? "").not.toMatch(NSEC_PATTERN);

    await popup.getByRole("button", { name: "Lock extension" }).click();
    const field = popup.getByLabel(/master password/i).first();
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill(PASSWORD);
    await popup.getByRole("button", { name: "Unlock" }).click();

    await expect(
      popup.getByRole("heading", { level: 2, name: KEY_LABEL })
    ).toBeVisible({ timeout: 15_000 });
    await expect(banner(popup)).toBeVisible();
    const after = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    expect(after).toEqual(keys);
  });

  test("closing the popup on the notice leaves one usable key, not a half-made vault", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await popup.setViewportSize({ width: 390, height: 700 });
    await popup.getByText("Quick start", { exact: true }).click();
    await popup.getByLabel("Master Password").fill(PASSWORD);
    await popup.getByLabel("Confirm Password").fill(PASSWORD);
    await popup.getByRole("button", { name: "Create identity" }).click();
    await expect(
      popup.getByRole("heading", { name: "Your identity is ready" })
    ).toBeVisible({ timeout: 20_000 });

    // The popup is closed before Continue: nothing marks onboarding complete.
    await popup.reload();

    await expect(
      popup.getByRole("heading", { level: 2, name: KEY_LABEL })
    ).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByRole("heading", { name: "Welcome to Ostrilo" })).toHaveCount(0);
    const keys = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    expect(keys).toHaveLength(1);
    await expect(banner(popup)).toBeVisible();
  });

  test("dismissing the banner lasts for the browser session and does not mark the key backed up", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await takeQuickStart(popup);

    await banner(popup).getByRole("button", { name: "Dismiss backup reminder" }).click();
    await expect(banner(popup)).toHaveCount(0);

    await popup.reload();
    await expect(
      popup.getByRole("heading", { level: 2, name: KEY_LABEL })
    ).toBeVisible({ timeout: 15_000 });
    await expect(banner(popup)).toHaveCount(0);

    const { statuses } = await sendExtensionRpc<{ statuses: Array<{ state: string }> }>(
      popup,
      { type: "backup.list" }
    );
    expect(statuses.map((row) => row.state)).toEqual(["pending"]);

    // A new browser session starts with an empty session store. Only the
    // dismissal is removed: the same store holds the vault's lock state.
    const [key] = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    await popup.evaluate(
      (id) => (globalThis as any).chrome.storage.session.remove(`backupBannerDismissed:${id}`),
      key.id
    );
    await popup.reload();
    await expect(banner(popup)).toBeVisible({ timeout: 15_000 });
  });

  test("backing up from the banner removes it, and writes a file that holds no secret in the clear", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await takeQuickStart(popup);
    const [key] = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    quickPubkey = key.pubkey;

    const opened = extensionContext.waitForEvent("page");
    await banner(popup).getByRole("button", { name: "Back up" }).click();
    const options = await opened;
    await options.waitForLoadState();
    expect(options.url()).toContain(`#keys?backup=${key.id}`);

    const reauth = options.getByRole("dialog");
    await reauth.locator("#reauth-password").fill(PASSWORD);
    await reauth.getByRole("button", { name: "Confirm" }).click();

    const backup = options.getByRole("dialog", { name: `Back up “${KEY_LABEL}”` });
    await expect(backup).toBeVisible({ timeout: 20_000 });
    // Acted on once: reloading must not ask for the password again.
    expect(options.url()).not.toContain("backup=");

    await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
    await backup
      .getByLabel("Confirm backup passphrase", { exact: true })
      .fill(BACKUP_PASSPHRASE);
    const downloaded = options.waitForEvent("download", { timeout: 30_000 });
    await backup.getByRole("button", { name: "Save file" }).click();
    await (await downloaded).saveAs(backupPath);
    expect(await fs.readFile(backupPath, "utf8")).not.toMatch(NSEC_PATTERN);

    // Saving is not a backup; the banner stays until the file is verified.
    await expect(banner(popup)).toBeVisible();

    await backup.getByLabel("Choose backup file").setInputFiles(backupPath);
    await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
    await backup.getByRole("button", { name: "Check file" }).click();
    await expect(backup.getByText("Backup verified")).toBeVisible({ timeout: 20_000 });

    // The popup was not touched: it hears the broadcast.
    await expect(banner(popup)).toHaveCount(0, { timeout: 15_000 });
    const { statuses } = await sendExtensionRpc<{
      statuses: Array<{ keyId: string; state: string }>;
    }>(popup, { type: "backup.list" });
    expect(statuses).toEqual([expect.objectContaining({ keyId: key.id, state: "verified" })]);
  });

  test("the file restores the identity in a fresh profile, with the same public key", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await popup.setViewportSize({ width: 390, height: 700 });
    await popup.getByText("Import Existing Key", { exact: true }).click();
    await popup.getByLabel("Upload key file").setInputFiles(backupPath);
    await popup.getByLabel("Backup passphrase").fill(BACKUP_PASSPHRASE);
    await popup.getByRole("button", { name: "Open backup" }).click();
    await expect(popup.getByLabel("Key Name")).toHaveValue(KEY_LABEL, { timeout: 20_000 });

    await popup.getByRole("button", { name: "Continue" }).click();
    await popup.getByLabel("Master Password").fill(PASSWORD);
    await popup.getByLabel("Confirm Password").fill(PASSWORD);
    await popup.getByRole("button", { name: "Import Key" }).click();
    await expect(popup.getByRole("heading", { name: "Import Successful" })).toBeVisible({
      timeout: 20_000,
    });
    await popup.getByRole("button", { name: "Get Started" }).click();
    await expect(
      popup.getByRole("heading", { level: 2, name: KEY_LABEL })
    ).toBeVisible({ timeout: 15_000 });

    const restored = await sendExtensionRpc<StoredKey[]>(popup, { type: "keys.list" });
    expect(restored).toHaveLength(1);
    expect(restored[0].pubkey, "the restored key is not the one that was backed up").toBe(
      quickPubkey
    );
    // An import is the user's own secret: no reminder to back it up.
    await expect(banner(popup)).toHaveCount(0);
  });
});

test.describe("Quick start is for a new vault only", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("an existing vault never shows the welcome choices", async ({ openPopup }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "Existing Key" });

    await expect(popup.getByText("Quick start", { exact: true })).toHaveCount(0);
    await expect(popup.getByRole("heading", { name: "Welcome to Ostrilo" })).toHaveCount(0);
  });
});

import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { seedUnlockedVault, sendExtensionRpc, TEST_PASSWORD } from "./fixtures/agent";

/**
 * The encrypted backup file, written by the product and read back by the
 * product.
 *
 * This is the only artefact Ostrilo produces that outlives the browser profile,
 * and it is the sole thing standing between a forgotten master password and a
 * permanently lost identity — the backup screen says so in as many words:
 * "No recovery service, no support channel and no reset exists". A file that
 * writes correctly but cannot be read back is therefore not a broken feature,
 * it is a destroyed identity that looks backed up.
 *
 * Nothing proved that round trip before this. `onboarding-import.spec.ts`
 * imports an envelope, but one the TEST constructed by calling
 * `createKeyBackup` directly, so it proves the reader understands the writer's
 * format — not that the button on the backup screen produces a file the
 * verification panel accepts. Here the product writes the file through its own
 * download path and the product's own panel reads that exact file back.
 */

const PASSWORD = "Harbour-Lantern-Quartz-2026!";
const BACKUP_PASSPHRASE = "Sextant-Meridian-Ballast-2026!";
const NSEC_PATTERN = /nsec1[02-9ac-hj-np-z]{20,}/i;

/** Walks onboarding as far as the backup step, where the export lives. */
async function reachBackupStep(popup: Page): Promise<void> {
  await popup.setViewportSize({ width: 390, height: 700 });
  await expect(
    popup.getByRole("heading", { name: "Welcome to Ostrilo" })
  ).toBeVisible();

  await popup.getByText("Create New Key", { exact: true }).click();
  await expect(
    popup.getByRole("heading", { name: "Create Your Nostr Key" })
  ).toBeVisible();

  await popup.getByLabel("Key Name").fill("Round Trip Key");
  await popup.getByLabel("Master Password").fill(PASSWORD);
  await popup.getByLabel("Confirm Password").fill(PASSWORD);
  await popup.getByRole("button", { name: /Create Key/i }).click();

  await expect(
    popup.getByRole("heading", { name: "Backup Your Key" })
  ).toBeVisible({ timeout: 15_000 });

  // Both the export panel and the verification panel are gated on
  // `hasRevealedPrivateKey` (OnboardingCreateKeyBackupStep.tsx:88-155). You
  // cannot back a key up without having been shown it first, which is the right
  // order: the file is worthless to someone who never saw the warning attached
  // to it.
  await popup.getByRole("button", { name: "Reveal Private Key" }).click();
  await expect(popup.getByLabel("Private Key (nsec format)")).toBeVisible();
}

/** Drives the export panel and returns the file the product actually wrote. */
async function saveBackupFile(
  popup: Page,
  passphrase: string
): Promise<{ path: string; text: string }> {
  await popup.getByRole("button", { name: "Save encrypted backup" }).click();
  await popup.getByLabel("Backup passphrase", { exact: true }).fill(passphrase);
  await popup
    .getByLabel("Confirm backup passphrase", { exact: true })
    .fill(passphrase);

  const downloaded = popup.waitForEvent("download", { timeout: 30_000 });
  await popup.getByRole("button", { name: "Save file" }).click();
  const download = await downloaded;

  const path = await download.path();
  expect(path, "the export produced no file on disk").toBeTruthy();
  return { path: path as string, text: await fs.readFile(path as string, "utf8") };
}

test.describe("encrypted backup round trip", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("the file the product writes is the file the product reads", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await reachBackupStep(popup);

    const { path, text } = await saveBackupFile(popup, BACKUP_PASSPHRASE);

    // The point of the envelope: the key is sealed, not merely relocated. The
    // predecessor to this feature wrote the nsec to disk in the clear.
    expect(text).not.toMatch(NSEC_PATTERN);
    const envelope = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(envelope).length).toBeGreaterThan(0);

    // The file route is only offered once a file has been saved, so its
    // presence is itself the signal that the export completed.
    const fileTab = popup.getByRole("tab", { name: "Use the saved file" });
    await expect(fileTab).toBeVisible();
    await fileTab.click();

    await popup.getByLabel("Choose backup file").setInputFiles(path);
    await popup.getByLabel("Backup passphrase", { exact: true }).fill(
      BACKUP_PASSPHRASE
    );
    await popup.getByRole("button", { name: "Check file" }).click();

    await expect(popup.getByText("Backup verified")).toBeVisible({
      timeout: 20_000,
    });
    await expect(popup.getByRole("button", { name: "Finish" })).toBeEnabled();
  });

  test("a wrong passphrase cannot verify the file", async ({ openPopup }) => {
    const popup = await openPopup();
    await reachBackupStep(popup);

    const { path } = await saveBackupFile(popup, BACKUP_PASSPHRASE);

    await popup.getByRole("tab", { name: "Use the saved file" }).click();
    await popup.getByLabel("Choose backup file").setInputFiles(path);
    await popup
      .getByLabel("Backup passphrase", { exact: true })
      .fill("Wrong-Passphrase-Entirely-2026!");
    await popup.getByRole("button", { name: "Check file" }).click();

    await expect(popup.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(popup.getByText("Backup verified")).toHaveCount(0);

    // The gate holds: an unverified backup does not release the flow.
    await expect(popup.getByRole("button", { name: "Finish" })).toBeDisabled();
  });

  /**
   * The passphrase is separate from the master password by design: sealing the
   * file under the same secret that protects the vault would mean one
   * compromised secret loses both. Verified here because the separation is only
   * real if the master password genuinely fails to open the file.
   */
  test("the master password does not open the backup file", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await reachBackupStep(popup);

    const { path } = await saveBackupFile(popup, BACKUP_PASSPHRASE);

    await popup.getByRole("tab", { name: "Use the saved file" }).click();
    await popup.getByLabel("Choose backup file").setInputFiles(path);
    await popup.getByLabel("Backup passphrase", { exact: true }).fill(PASSWORD);
    await popup.getByRole("button", { name: "Check file" }).click();

    await expect(popup.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(popup.getByText("Backup verified")).toHaveCount(0);
  });
});

/**
 * Backing up a key that was added after onboarding, from Settings.
 *
 * Two tests in one serial group because the second must run in a FRESH profile:
 * the file the first test writes is the only thing carried across, which is
 * what a backup is for. A key that restores to a different public key, or that
 * does not restore at all, would be a backup that looks complete and is not.
 */
test.describe("Settings backup, restored in a fresh profile", () => {
  test.describe.configure({ mode: "serial" });

  const SECOND_LABEL = "Second Key";
  let dir: string;
  let backupPath: string;
  let secondPubkey: string;

  async function statusOf(page: Page, keyId: string): Promise<string | undefined> {
    const { statuses } = await sendExtensionRpc<{
      statuses: Array<{ keyId: string; state: string }>;
    }>(page, { type: "backup.list" });
    return statuses.find((row) => row.keyId === keyId)?.state;
  }

  test.beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ostrilo-settings-backup-"));
    backupPath = path.join(dir, "settings-backup.json");
  });

  test.afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("a key added in Settings starts with no backup and is verified by backing it up", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup, { label: "First Key" });

    const options = await openOptions();
    await options.getByRole("tab", { name: "Keys & Identities" }).click();
    await options.getByRole("button", { name: "Add Key" }).click();
    const addDialog = options.getByRole("dialog");
    await addDialog.getByRole("button", { name: "Create New Key" }).click();
    await addDialog.getByLabel("Vault Password").fill(TEST_PASSWORD);
    await addDialog.getByLabel("Key Name").fill(SECOND_LABEL);
    await addDialog.getByRole("button", { name: "Create Key" }).click();

    const rows = options
      .getByRole("list", { name: "Manage your Nostr keys" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    const first = rows.filter({ hasText: "First Key" });
    const second = rows.filter({ hasText: SECOND_LABEL });

    // Both were made here, so both start with no backup. Neither is hidden
    // behind the active key's chip.
    await expect(first).toContainText("No backup");
    await expect(second).toContainText("No backup");

    const stored = await sendExtensionRpc<Array<{ id: string; label: string; pubkey: string }>>(
      popup,
      { type: "keys.list" }
    );
    const secondKey = stored.find((key) => key.label === SECOND_LABEL)!;
    secondPubkey = secondKey.pubkey;
    const secondPubkeyId = secondKey.id;

    await second.getByRole("button", { name: `Back up ${SECOND_LABEL}` }).click();
    const reauth = options.getByRole("dialog");
    await reauth.locator("#reauth-password").fill(TEST_PASSWORD);
    await reauth.getByRole("button", { name: "Confirm" }).click();

    const backup = options.getByRole("dialog", { name: `Back up “${SECOND_LABEL}”` });
    await expect(backup).toBeVisible({ timeout: 20_000 });
    await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
    await backup
      .getByLabel("Confirm backup passphrase", { exact: true })
      .fill(BACKUP_PASSPHRASE);
    const downloaded = options.waitForEvent("download", { timeout: 30_000 });
    await backup.getByRole("button", { name: "Save file" }).click();
    const download = await downloaded;
    await download.saveAs(backupPath);

    const text = await fs.readFile(backupPath, "utf8");
    expect(text).not.toMatch(NSEC_PATTERN);
    // Saving the file is not yet a backup: nothing proves it opens. Read from
    // the background, because the open dialog hides the list behind it.
    expect(await statusOf(popup, secondPubkeyId)).toBe("pending");

    await backup.getByLabel("Choose backup file").setInputFiles(backupPath);
    await backup.getByLabel("Backup passphrase", { exact: true }).fill(BACKUP_PASSPHRASE);
    await backup.getByRole("button", { name: "Check file" }).click();
    await expect(backup.getByText("Backup verified")).toBeVisible({ timeout: 20_000 });
    expect(await statusOf(popup, secondPubkeyId)).toBe("verified");

    await backup.getByRole("button", { name: "Done" }).click();
    await expect(second).not.toContainText("No backup");
    await expect(first).toContainText("No backup");
  });

  test("the file restores the key in a fresh profile, with the same public key", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    await popup.setViewportSize({ width: 390, height: 700 });
    await popup.getByText("Import Existing Key", { exact: true }).click();
    await expect(popup.getByRole("heading", { name: "Import Your Key" })).toBeVisible();

    await popup.getByLabel("Upload key file").setInputFiles(backupPath);
    await popup.getByLabel("Backup passphrase").fill(BACKUP_PASSPHRASE);
    await popup.getByRole("button", { name: "Open backup" }).click();
    await expect(popup.getByLabel("Key Name")).toHaveValue(SECOND_LABEL, {
      timeout: 20_000,
    });

    await popup.getByRole("button", { name: "Continue" }).click();
    await popup.getByLabel("Master Password").fill(PASSWORD);
    await popup.getByLabel("Confirm Password").fill(PASSWORD);
    await popup.getByRole("button", { name: "Import Key" }).click();
    await expect(popup.getByRole("heading", { name: "Import Successful" })).toBeVisible({
      timeout: 20_000,
    });
    await popup.getByRole("button", { name: "Get Started" }).click();
    await expect(
      popup.getByRole("heading", { level: 2, name: SECOND_LABEL })
    ).toBeVisible({ timeout: 15_000 });

    const restored = await sendExtensionRpc<Array<{ pubkey: string }>>(popup, {
      type: "keys.list",
    });
    expect(restored).toHaveLength(1);
    expect(restored[0].pubkey, "the restored key is not the one that was backed up").toBe(
      secondPubkey
    );
  });
});

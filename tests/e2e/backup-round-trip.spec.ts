import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import fs from "node:fs/promises";

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
  await popup.getByRole("button", { name: "Continue" }).click();
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

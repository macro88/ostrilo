import { test, expect } from "./fixtures/extension";

/**
 * The create-and-backup loop, end to end in a real extension document.
 *
 * This replaces a skipped placeholder. It is the only place that exercises the
 * whole chain the `secure-key-backup-flow` change is about: generate, reveal
 * with the password re-verified in the background, copy with a bounded
 * clipboard window, prove the backup was recorded, and only then finish.
 *
 * The assertions worth keeping if this spec is ever rewritten:
 *  - the nsec is NOT in the DOM until the user asks for it;
 *  - Finish is disabled until verification passes, ticked checkbox or not;
 *  - no control offers a plaintext download.
 */

const PASSWORD = "Umbrella-Thistle-Quarry-2026!";
const KEY_NAME = "Create Flow Key";
const VERIFICATION_SUFFIX_LENGTH = 8;

test.describe("Onboarding - Create Key", () => {
  test("user creates a key, verifies the backup, and lands on Home", async ({
    openPopup,
  }) => {
    const page = await openPopup();
    await page.setViewportSize({ width: 390, height: 700 });

    await expect(
      page.getByRole("heading", { name: "Welcome to Ostrilo" })
    ).toBeVisible();

    await page.getByText("Create New Key", { exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "Create Your Nostr Key" })
    ).toBeVisible();
    await page.getByLabel("Key Name").fill(KEY_NAME);
    await page.getByLabel("Master Password").fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await page.getByRole("button", { name: /Create Key/i }).click();

    await expect(
      page.getByRole("heading", { name: "Backup Your Key" })
    ).toBeVisible({ timeout: 15_000 });

    // Finish is unavailable before the key has even been revealed.
    const finish = page.getByRole("button", { name: "Finish" });
    await expect(finish).toBeDisabled();

    await page.getByRole("button", { name: "Reveal Private Key" }).click();

    const keyField = page.getByLabel("Private Key (nsec format)");
    await expect(keyField).toBeVisible();
    // Masked: the DOM holds bullets, not the key.
    await expect(keyField).not.toHaveValue(/^nsec1/);
    // And it is not a password field, which is what managers capture on.
    await expect(keyField).toHaveAttribute("type", "text");
    await expect(keyField).toHaveAttribute("autocomplete", "off");

    await page.getByRole("button", { name: "Show private key" }).click();
    await expect(keyField).toHaveValue(/^nsec1/);
    const nsec = await keyField.inputValue();

    // The plaintext download is gone. Only the encrypted export remains.
    await expect(
      page.getByRole("button", { name: /Download Backup/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Save encrypted backup/i })
    ).toBeVisible();

    // The clipboard window is announced before the copy, with its interval.
    await expect(page.getByText(/clears the clipboard automatically/i))
      .toBeVisible();
    await expect(page.getByText(/45 seconds/)).toBeVisible();

    // Ticking the acknowledgement is not evidence and must not enable Finish.
    await page
      .getByRole("checkbox", { name: "Confirm private key backup" })
      .check();
    await expect(finish).toBeDisabled();

    // A wrong answer keeps it disabled and says what to do next.
    const verification = page.getByLabel(
      `Last ${VERIFICATION_SUFFIX_LENGTH} characters of your nsec`
    );
    await verification.fill("zzzzzzzz");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByText(/Reveal it again/i)).toBeVisible();
    await expect(finish).toBeDisabled();

    await verification.fill(nsec.slice(-VERIFICATION_SUFFIX_LENGTH));
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByText("Backup verified")).toBeVisible();
    await expect(finish).toBeEnabled();

    await finish.click();

    await expect(
      page.getByRole("heading", { level: 2, name: KEY_NAME })
    ).toBeVisible({ timeout: 15_000 });
  });
});

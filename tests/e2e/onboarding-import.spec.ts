import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { sendExtensionRpc } from "./fixtures/agent";
import {
  createKeyBackup,
  serializeKeyBackup,
  type KeyBackupPayload,
} from "@/ui/features/onboarding/backup/key-backup-envelope";

/**
 * The import-key onboarding journey, end to end in a real extension document.
 *
 * This replaces a skipped placeholder whose TODO described a flow that does not
 * exist ("require backup checkbox before enabling Get Started"). The import
 * path has no backup-verification gate and should not have one: the user
 * already holds the key they are typing in, so there is nothing to prove they
 * wrote down. The gates it does have are asserted here instead, each one by
 * showing that progress stops until it is satisfied:
 *
 *  - a key that does not parse never reaches the password step;
 *  - a key with no name never reaches the password step;
 *  - a mismatched or policy-violating password never creates a key, and the
 *    background refuses it even when the UI is bypassed entirely;
 *  - an encrypted backup file yields nothing without its passphrase.
 *
 * The assertions worth keeping if this spec is ever rewritten:
 *  - the imported identity is the one the nsec actually derives to, checked
 *    against a hard-coded vector rather than against whatever Ostrilo produced;
 *  - every rejected input leaves `keys.list` empty - a visible error message is
 *    not evidence that nothing was written;
 *  - a wrong passphrase and a tampered backup fail with the SAME message.
 */

/**
 * NIP-19's published example private key, the same vector
 * `tests/unit/ui/features/onboarding/key-backup-envelope.test.ts` uses.
 *
 * The public key was derived from it OUTSIDE this repository's code, with
 * `@noble/curves` schnorr.getPublicKey over the raw 32 bytes, and the npub is
 * that x-only public key in bech32. Asserting against these constants is what
 * makes this a known-answer test: importing an nsec and then asking Ostrilo
 * what it imported would pass just as happily for a parser that dropped a byte.
 */
const VECTOR_NSEC =
  "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const VECTOR_PRIVATE_HEX =
  "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const VECTOR_PUBKEY_HEX =
  "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
const VECTOR_NPUB =
  "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg";

/** What `Pubkey` renders on Home: first 8 characters, ellipsis, last 6. */
const VECTOR_NPUB_ON_HOME = `${VECTOR_NPUB.slice(0, 8)}…${VECTOR_NPUB.slice(-6)}`;

const PASSWORD = "Driftwood-Compass-Quarry-2026!";
const KEY_NAME = "Imported Vector Key";
const BACKUP_PASSPHRASE = "correct-horse-battery-staple-42";

/**
 * The string the import step currently renders for a key it refuses.
 *
 * It is a raw RPC error code, not a sentence: `RpcClientError.message` is
 * `rpc:<method>:<errorCode>` and `validateImport` puts `error.message` straight
 * into the error chip. Asserted verbatim because that is what a user sees. If
 * this ever becomes a human-readable message the assertion should be updated to
 * the new text, not relaxed.
 */
const REFUSED_KEY_MESSAGE = "rpc:crypto.parsePrivateKey:invalid_key_input";

interface StoredKey {
  id: string;
  label?: string;
  pubkey: string;
  npub?: string;
}

async function listStoredKeys(page: Page): Promise<StoredKey[]> {
  return await sendExtensionRpc<StoredKey[]>(page, { type: "keys.list" });
}

/** Welcome screen through to the "Import Your Key" step. */
async function startImportFlow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(
    page.getByRole("heading", { name: "Welcome to Ostrilo" })
  ).toBeVisible();

  await page.getByText("Import Existing Key", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Import Your Key" })
  ).toBeVisible();
}

/** Writes a genuine Ostrilo encrypted backup, sealed by the product's own code. */
async function writeEncryptedBackup(
  dir: string,
  fileName: string,
  payload: KeyBackupPayload,
  passphrase: string,
  tamper?: (serialized: string) => string
): Promise<string> {
  const envelope = await createKeyBackup(payload, passphrase);
  const serialized = serializeKeyBackup(envelope);
  const filePath = path.join(dir, fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, tamper ? tamper(serialized) : serialized, "utf8");
  return filePath;
}

test.describe("Onboarding - Import Key", () => {
  test("imports an nsec and lands on Home as the identity that nsec derives to", async ({
    openPopup,
  }) => {
    const page = await openPopup();
    await startImportFlow(page);

    const keyField = page.getByLabel("Private Key (nsec)");
    // Not `type="password"`. That attribute is what password managers key off,
    // and an nsec captured into a third-party vault cannot be rotated away.
    await expect(keyField).toHaveAttribute("type", "text");
    await expect(keyField).toHaveAttribute("autocomplete", "off");

    await page.getByLabel("Key Name").fill(KEY_NAME);
    await keyField.fill(VECTOR_NSEC);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "Secure Your Key" })
    ).toBeVisible();
    // The step reports that the background parsed the key, not that the string
    // looked plausible: the verdict comes from crypto.parsePrivateKey.
    await expect(page.getByText("Key Validated")).toBeVisible();
    await expect(
      page.getByText(`Private key "${KEY_NAME}" is ready for import`)
    ).toBeVisible();

    await page.getByLabel("Master Password").fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await expect(page.getByText(/Good|Strong/)).toBeVisible();

    await page.getByRole("button", { name: "Import Key" }).click();

    await expect(
      page.getByRole("heading", { name: "Import Successful" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`"${KEY_NAME}" is ready to use`)).toBeVisible();

    // `dropSensitiveState` runs BEFORE this step renders, and the component
    // behind it stays mounted. No field anywhere in the document may still hold
    // the nsec the user typed.
    const residue = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map((el) => el.value)
    );
    expect(
      residue.some((value) => value.startsWith("nsec1")),
      "SECURITY REGRESSION: the imported nsec was still in an input after import"
    ).toBe(false);

    // The import path deliberately has NO backup-verification gate, unlike the
    // create path: the user supplied the key, so there is nothing to prove they
    // wrote down. Get Started is the only control and it is live immediately.
    const getStarted = page.getByRole("button", { name: "Get Started" });
    await expect(getStarted).toBeEnabled();
    await expect(
      page.getByRole("checkbox", { name: "Confirm private key backup" })
    ).toHaveCount(0);

    await getStarted.click();

    await expect(
      page.getByRole("heading", { level: 2, name: KEY_NAME })
    ).toBeVisible({ timeout: 15_000 });

    // The identity on screen is the one the vector derives to. A truncation is
    // asserted rather than the whole npub because that is all Home renders.
    await expect(page.getByLabel("Public key display")).toContainText(
      VECTOR_NPUB_ON_HOME
    );

    const keys = await listStoredKeys(page);
    expect(keys).toHaveLength(1);
    expect(
      keys[0].pubkey,
      "the imported key is not the one this nsec derives to"
    ).toBe(VECTOR_PUBKEY_HEX);
    expect(keys[0].npub).toBe(VECTOR_NPUB);
    expect(keys[0].label).toBe(KEY_NAME);

    // Importing signs the user in: `handleSetPassword` unlocks with the
    // password it just encrypted under, so Home is a usable surface and not a
    // lock screen wearing a key name.
    const lock = await sendExtensionRpc<{ isLocked: boolean }>(page, {
      type: "state.getLock",
    });
    expect(lock.isLocked).toBe(false);
  });

  test("hex private keys are accepted, and the two forms of the same key agree", async ({
    openPopup,
  }) => {
    const page = await openPopup();
    await startImportFlow(page);

    // The step's own "Supported formats" list promises 64-char hex. A format
    // the UI advertises and the parser refuses is a broken promise, and the
    // vector proves hex and nsec resolve to the same identity.
    await expect(page.getByText("Hex private key (64 characters)")).toBeVisible();

    await page.getByLabel("Key Name").fill(KEY_NAME);
    await page.getByLabel("Private Key (nsec)").fill(VECTOR_PRIVATE_HEX);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "Secure Your Key" })
    ).toBeVisible();

    await page.getByLabel("Master Password").fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Import Key" }).click();

    await expect(
      page.getByRole("heading", { name: "Import Successful" })
    ).toBeVisible({ timeout: 15_000 });

    const keys = await listStoredKeys(page);
    expect(keys).toHaveLength(1);
    expect(keys[0].pubkey).toBe(VECTOR_PUBKEY_HEX);
  });

  test("a malformed private key is refused, stops the flow, and stores nothing", async ({
    openPopup,
  }) => {
    const page = await openPopup();
    await startImportFlow(page);

    const keyField = page.getByLabel("Private Key (nsec)");
    const nameField = page.getByLabel("Key Name");
    const secureHeading = page.getByRole("heading", { name: "Secure Your Key" });
    const continueButton = page.getByRole("button", { name: "Continue" });

    // Empty form. `validateImport` checks presence of the key, then presence of
    // the name, and only then asks the background to parse - so these three
    // messages are asserted in the order a user actually meets them.
    await continueButton.click();
    await expect(page.getByText("Private key is required")).toBeVisible();
    await expect(secureHeading).toHaveCount(0);

    // A valid key with no name is still refused: the name is what the user
    // later picks this identity by.
    await keyField.fill(VECTOR_NSEC);
    await continueButton.click();
    await expect(page.getByText("Key name is required")).toBeVisible();
    await expect(secureHeading).toHaveCount(0);

    await nameField.fill(KEY_NAME);

    /**
     * Each rejection below must be produced FRESHLY.
     *
     * The error chip only clears on a successful validation, so asserting the
     * same message twice in a row would pass even if the second click did
     * nothing at all. Between cases this walks forward through the gate and
     * back, which clears the chip, and asserts the chip is gone before the next
     * bad input is tried.
     */
    const expectRefused = async (keyInput: string) => {
      await expect(page.getByText(REFUSED_KEY_MESSAGE)).toHaveCount(0);
      await keyField.fill(keyInput);
      await continueButton.click();
      await expect(page.getByText(REFUSED_KEY_MESSAGE)).toBeVisible();
      await expect(secureHeading).toHaveCount(0);

      // Clear the chip by satisfying the gate, then step back for the next case.
      await keyField.fill(VECTOR_NSEC);
      await continueButton.click();
      await expect(secureHeading).toBeVisible();
      await page.getByRole("button", { name: "Back" }).click();
      await expect(
        page.getByRole("heading", { name: "Import Your Key" })
      ).toBeVisible();
    };

    // Not key-shaped: refused by KeyInputSchema before the parser sees it.
    await expectRefused("not-an-nsec");

    // Key-SHAPED but not a key: `nsec1` plus the right alphabet and length, so
    // it passes the schema's regex and is refused by the bech32 checksum. This
    // is the case a regex-only check would let through, and the one that would
    // silently import a mistyped key under a plausible-looking identity.
    await expectRefused(
      `${VECTOR_NSEC.slice(0, -1)}${VECTOR_NSEC.endsWith("5") ? "4" : "5"}`
    );

    // A PUBLIC key, pasted where the private key goes. `KeyInputSchema` accepts
    // npub on purpose, so the parser is the only thing standing between this
    // paste and a vault entry holding a key that cannot sign.
    await expectRefused(VECTOR_NPUB);

    expect(
      await listStoredKeys(page),
      "a refused key input still wrote a key record"
    ).toHaveLength(0);

    // The gate is a gate, not a wall: a key that parses proceeds.
    await keyField.fill(VECTOR_NSEC);
    await continueButton.click();
    await expect(secureHeading).toBeVisible();
  });

  test("the new-vault password policy gates the import path, in the UI and in the background", async ({
    openPopup,
  }) => {
    const page = await openPopup();
    await startImportFlow(page);

    await page.getByLabel("Key Name").fill(KEY_NAME);
    await page.getByLabel("Private Key (nsec)").fill(VECTOR_NSEC);
    await page.getByRole("button", { name: "Continue" }).click();

    const password = page.getByLabel("Master Password");
    const confirm = page.getByLabel("Confirm Password");
    const importButton = page.getByRole("button", { name: "Import Key" });
    const successHeading = page.getByRole("heading", {
      name: "Import Successful",
    });

    await expect(password).toBeVisible();

    // Confirmation mismatch: caught before any RPC.
    await password.fill(PASSWORD);
    await confirm.fill(`${PASSWORD}x`);
    await importButton.click();
    // `.first()` because the message is rendered TWICE: `PasswordInput` shows
    // its own live mismatch chip as the confirmation is typed, and
    // `validatePassword` sets the same text again on submit.
    await expect(
      page.getByText("Passwords do not match").first()
    ).toBeVisible();
    await expect(successHeading).toHaveCount(0);

    // Below the 12-character floor. The verdict is the background's, which is
    // the whole point: a UI that re-implemented the predicate is how "Aa1!"
    // was once accepted as a vault password.
    await password.fill("short1!");
    await confirm.fill("short1!");
    await importButton.click();
    await expect(
      page.getByText("Password must be at least 12 characters.")
    ).toBeVisible();
    await expect(successHeading).toHaveCount(0);

    // Long enough, but it names the product.
    await password.fill("my-nostr-signing-password");
    await confirm.fill("my-nostr-signing-password");
    await importButton.click();
    await expect(
      page.getByText(
        "Avoid using the app name or your key name in the password."
      )
    ).toBeVisible();
    await expect(successHeading).toHaveCount(0);

    expect(
      await listStoredKeys(page),
      "a refused password still wrote a key record"
    ).toHaveLength(0);

    // The UI check is not the gate. Driving vault.import directly is what an
    // attacker - or a future caller that forgets to pre-validate - does, and
    // `enforceNewPasswordPolicy` has to refuse it there too.
    await expect(
      sendExtensionRpc(page, {
        type: "vault.import",
        keyInput: VECTOR_NSEC,
        password: "short1!",
        label: KEY_NAME,
      }),
      "SECURITY REGRESSION: the background imported a key under a password its own policy refuses"
    ).rejects.toThrow(/invalid_password/);

    expect(await listStoredKeys(page)).toHaveLength(0);

    // And an acceptable password still gets through.
    await password.fill(PASSWORD);
    await confirm.fill(PASSWORD);
    await importButton.click();
    await expect(successHeading).toBeVisible({ timeout: 15_000 });
    expect(await listStoredKeys(page)).toHaveLength(1);
  });

  test("an Ostrilo encrypted backup file is opened with its passphrase and imported", async ({
    openPopup,
  }, testInfo) => {
    const page = await openPopup();
    await startImportFlow(page);

    // A real envelope, sealed by the product's own exporter. Fabricating one in
    // the test would only prove the test can encrypt.
    const backupPath = await writeEncryptedBackup(
      testInfo.outputDir,
      "ostrilo-backup-e2e.json",
      { nsec: VECTOR_NSEC, hex: VECTOR_PRIVATE_HEX, name: KEY_NAME },
      BACKUP_PASSPHRASE
    );
    expect(
      fs.readFileSync(backupPath, "utf8"),
      "the backup file on disk contains a readable key"
    ).not.toContain("nsec1");

    await page.getByLabel("Upload key file").setInputFiles(backupPath);

    // The file is recognised and held, NOT dropped into the key field: an
    // encrypted backup is unreadable until its passphrase is supplied.
    await expect(
      page.getByText("Encrypted backup: ostrilo-backup-e2e.json")
    ).toBeVisible();
    const keyField = page.getByLabel("Private Key (nsec)");
    await expect(keyField).toHaveValue("");

    const openBackup = page.getByRole("button", { name: "Open backup" });
    await expect(openBackup).toBeDisabled();

    // Wrong passphrase: refused, and nothing leaks into the key field.
    const passphrase = page.getByLabel("Backup passphrase");
    await passphrase.fill("not-the-passphrase");
    await expect(openBackup).toBeEnabled();
    await openBackup.click();
    await expect(page.getByRole("alert")).toContainText(
      "Could not open this backup.",
      { timeout: 15_000 }
    );
    await expect(keyField).toHaveValue("");

    await passphrase.fill(BACKUP_PASSPHRASE);
    await openBackup.click();

    // The panel closes on success, and the name travelled inside the
    // ciphertext rather than in the filename.
    await expect(
      page.getByText("Encrypted backup: ostrilo-backup-e2e.json")
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByLabel("Key Name")).toHaveValue(KEY_NAME);

    await page.getByRole("button", { name: "Show private key" }).click();
    await expect(keyField).toHaveValue(VECTOR_NSEC);

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Secure Your Key" })
    ).toBeVisible();
    await page.getByLabel("Master Password").fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Import Key" }).click();

    await expect(
      page.getByRole("heading", { name: "Import Successful" })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Get Started" }).click();

    await expect(
      page.getByRole("heading", { level: 2, name: KEY_NAME })
    ).toBeVisible({ timeout: 15_000 });

    // The key recovered from the file is re-encrypted under the master
    // password the user just chose, and it is the right key.
    const keys = await listStoredKeys(page);
    expect(keys).toHaveLength(1);
    expect(keys[0].pubkey).toBe(VECTOR_PUBKEY_HEX);
  });

  test("a tampered backup fails exactly as a wrong passphrase does", async ({
    openPopup,
  }, testInfo) => {
    const page = await openPopup();
    await startImportFlow(page);

    // One flipped base64 character in the ciphertext. AES-GCM cannot tell this
    // apart from a wrong passphrase without leaking, so the message must not
    // try: a message that distinguished them would tell an attacker holding the
    // file which of their guesses was closest.
    const tamperedPath = await writeEncryptedBackup(
      testInfo.outputDir,
      "ostrilo-backup-tampered.json",
      { nsec: VECTOR_NSEC, hex: VECTOR_PRIVATE_HEX, name: KEY_NAME },
      BACKUP_PASSPHRASE,
      (serialized) => {
        const envelope = JSON.parse(serialized) as { ct: string };
        const first = envelope.ct[0];
        envelope.ct = `${first === "A" ? "B" : "A"}${envelope.ct.slice(1)}`;
        return JSON.stringify(envelope, null, 2);
      }
    );

    await page.getByLabel("Upload key file").setInputFiles(tamperedPath);
    await expect(
      page.getByText("Encrypted backup: ostrilo-backup-tampered.json")
    ).toBeVisible();

    await page.getByLabel("Backup passphrase").fill(BACKUP_PASSPHRASE);
    await page.getByRole("button", { name: "Open backup" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Could not open this backup. Check the passphrase and that the file is the one Ostrilo wrote.",
      { timeout: 15_000 }
    );
    // The CORRECT passphrase was used here. Saying so would confirm to whoever
    // holds the file that they have guessed it.
    await expect(alert).not.toContainText(/tamper|modified|corrupt/i);
    await expect(page.getByLabel("Private Key (nsec)")).toHaveValue("");
    expect(await listStoredKeys(page)).toHaveLength(0);
  });

  test("a plaintext key file still imports, and is validated like a typed key", async ({
    openPopup,
  }, testInfo) => {
    const page = await openPopup();
    await startImportFlow(page);

    // This build writes only encrypted backups, but files written by older
    // builds exist on disk and have to stay importable - otherwise the upgrade
    // silently strands a user's only copy of an unrotatable identity.
    const legacyPath = path.join(testInfo.outputDir, "legacy-export.json");
    fs.mkdirSync(testInfo.outputDir, { recursive: true });
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        name: KEY_NAME,
        privateKey: VECTOR_NSEC,
        privateKeyHex: VECTOR_PRIVATE_HEX,
        createdAt: 1700000000,
      }),
      "utf8"
    );

    await page.getByLabel("Upload key file").setInputFiles(legacyPath);

    // No passphrase prompt: this is not an Ostrilo envelope, so it takes the
    // plain path and fills both fields directly.
    await expect(page.getByLabel("Key Name")).toHaveValue(KEY_NAME);
    await expect(page.getByText(/^Encrypted backup: /)).toHaveCount(0);

    await page.getByRole("button", { name: "Show private key" }).click();
    await expect(page.getByLabel("Private Key (nsec)")).toHaveValue(
      VECTOR_NSEC
    );

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByRole("heading", { name: "Secure Your Key" })
    ).toBeVisible();

    await page.getByLabel("Master Password").fill(PASSWORD);
    await page.getByLabel("Confirm Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Import Key" }).click();

    await expect(
      page.getByRole("heading", { name: "Import Successful" })
    ).toBeVisible({ timeout: 15_000 });

    const keys = await listStoredKeys(page);
    expect(keys).toHaveLength(1);
    expect(keys[0].pubkey).toBe(VECTOR_PUBKEY_HEX);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingImportKey } from "@/ui/features/onboarding/components/OnboardingImportKey";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  createKeyBackup,
  serializeKeyBackup,
} from "@/ui/features/backup/key-backup-envelope";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { background } from "./fake-background";
import {
  alertText,
  button,
  chooseFile,
  click,
  input,
  render,
  setValue,
  settle,
  silenceConsole,
  unmountAll,
} from "./dom";


vi.mock("wxt/browser", async () => (await import("./fake-background")).wxtBrowserModule);

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const PASSWORD = "Violet-Harbor-Quill-8472-otter";
const BACKUP_PASSPHRASE = "Amber-Lantern-Fjord-3196-heron";
const CRYPTO_TIMEOUT = { timeout: 60_000 };

async function mount() {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const view = render(
    <KeyManagerProvider>
      <OnboardingImportKey onBack={onBack} onComplete={onComplete} />
    </KeyManagerProvider>
  );
  await settle(() => !button(view.container, "Continue").disabled);
  return { ...view, onBack, onComplete };
}

const keyField = (root: HTMLElement) => input(root, "#privateKey");
const nameField = (root: HTMLElement) => input(root, "#keyName");

async function continueFromKeyStep(root: HTMLElement) {
  await click(button(root, "Continue"));
  await settle(
    () =>
      root.querySelector("#password") !== null ||
      root.querySelector("p.text-destructive") !== null
  );
}

async function reachPasswordStep(root: HTMLElement, key = NSEC) {
  setValue(nameField(root), "Recovered");
  setValue(keyField(root), key);
  await continueFromKeyStep(root);
  expect(root.querySelector("#password")).not.toBeNull();
}

function enterPassword(root: HTMLElement, password: string, confirm = password) {
  setValue(input(root, "#password"), password);
  setValue(input(root, "#confirm-password"), confirm);
}

async function importAndSettle(root: HTMLElement) {
  await click(button(root, "Import Key"));
  await settle(
    () =>
      root.textContent?.includes("Import Successful") === true ||
      root.querySelector("#password")?.getAttribute("aria-invalid") === "true"
  );
}

async function openFile(root: HTMLElement, contents: string, name: string) {
  await chooseFile(
    input(root, "#file-upload"),
    new File([contents], name, { type: "application/json" })
  );
}

async function sealedBackup(name = "From backup") {
  const envelope = await createKeyBackup(
    { nsec: NSEC, hex: HEX, name },
    BACKUP_PASSPHRASE
  );
  return serializeKeyBackup(envelope);
}

beforeEach(() => {
  silenceConsole();
  background.reset();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("onboarding import rejects bad key input on the key step", () => {
  it("asks for a key before anything is sent", async () => {
    const { container } = await mount();
    setValue(nameField(container), "Recovered");

    await continueFromKeyStep(container);

    expect(container.textContent).toContain("Private key is required");
    expect(background.sent("crypto.parsePrivateKey")).toHaveLength(0);
  });

  it("asks for a key name before anything is sent", async () => {
    const { container } = await mount();
    setValue(keyField(container), NSEC);

    await continueFromKeyStep(container);

    expect(container.textContent).toContain("Key name is required");
    expect(background.sent("crypto.parsePrivateKey")).toHaveLength(0);
  });

  it.each([
    ["an nsec with a broken checksum", `${NSEC.slice(0, -1)}q`],
    ["a hex key one character short", HEX.slice(1)],
    ["a string that is neither", "not a key at all"],
  ])("keeps the user on the key step for %s", async (_label, badKey) => {
    const { container } = await mount();
    setValue(nameField(container), "Recovered");
    setValue(keyField(container), badKey);

    await continueFromKeyStep(container);

    expect(container.textContent).toContain("That is not a valid private key.");
    expect(container.querySelector("#password")).toBeNull();
    expect(keyField(container).getAttribute("aria-invalid")).toBe("true");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("accepts a raw hex key and moves on to the password", async () => {
    const { container } = await mount();

    await reachPasswordStep(container, HEX);

    expect(container.textContent).toContain("Key Validated");
    expect(container.textContent).toContain('Private key "Recovered" is ready');
  });


  it("leaves the flow when the user goes back from the key step", async () => {
    const { container, onBack } = await mount();

    await click(button(container, "Back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("onboarding import gates the master password", () => {
  it("requires a password", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);

    await importAndSettle(container);

    expect(container.textContent).toContain("Password is required");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("refuses a confirmation that does not match", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);
    enterPassword(container, PASSWORD, `${PASSWORD}x`);

    await importAndSettle(container);

    expect(container.textContent).toContain("Passwords do not match");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("refuses a password the background policy rejects", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);
    enterPassword(container, "password1");

    await importAndSettle(container);

    expect(container.querySelector("#password")).not.toBeNull();
    expect(input(container, "#password").getAttribute("aria-invalid")).toBe("true");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("says the policy was not met when the verdict names no violation", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);
    background.respond("crypto.evaluatePassword", () => ({
      ok: true,
      data: {
        acceptable: false,
        violations: [],
        requirements: [],
        score: 0,
        blocklistChecked: true,
      },
    }));
    enterPassword(container, PASSWORD);

    await importAndSettle(container);

    expect(container.textContent).toContain("Password does not meet the policy.");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("fails closed when the strength check cannot be reached", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);
    background.fail("crypto.evaluatePassword", RPC_ERROR_CODES.TIMEOUT);
    enterPassword(container, PASSWORD);

    await importAndSettle(container);

    expect(container.textContent).toContain("Could not validate password strength");
    expect(background.sent("vault.import")).toHaveLength(0);
  });

  it("returns to the key step from the password step", async () => {
    const { container } = await mount();
    await reachPasswordStep(container);

    await click(button(container, "Back"));

    expect(container.querySelector("#password")).toBeNull();
    expect(container.querySelector("#privateKey")).not.toBeNull();
  });
});

describe("onboarding import completes through the vault", () => {
  it("imports, unlocks, and drops the password before the success screen", async () => {
    const { container, onComplete } = await mount();
    await reachPasswordStep(container);
    enterPassword(container, PASSWORD);

    await importAndSettle(container);

    expect(background.sent("vault.import")).toEqual([
      { type: "vault.import", keyInput: NSEC, password: PASSWORD, label: "Recovered" },
    ]);
    expect(background.sent("vault.unlock")).toEqual([
      { type: "vault.unlock", password: PASSWORD },
    ]);
    expect(container.textContent).toContain("Import Successful");
    expect(container.textContent).toContain('"Recovered" is ready to use');
    expect(container.querySelector("input")).toBeNull();

    await click(button(container, "Get Started"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("stays on the password step with the vault's error when unlock fails", async () => {
    background.fail("vault.unlock", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container, onComplete } = await mount();
    await reachPasswordStep(container);
    enterPassword(container, PASSWORD);

    await importAndSettle(container);

    expect(container.textContent).toContain("That password was not accepted.");
    expect(input(container, "#password").value).toBe("");
    expect(input(container, "#confirm-password").value).toBe("");
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("onboarding import reads key files", () => {
  it("fills the key and name from a legacy plaintext export", async () => {
    const { container } = await mount();

    await openFile(
      container,
      JSON.stringify({ name: "Legacy", privateKey: NSEC, privateKeyHex: HEX }),
      "old-export.json"
    );
    await settle(() => keyField(container).value !== "");

    expect(keyField(container).value).toBe(NSEC);
    expect(nameField(container).value).toBe("Legacy");
  });

  it("keeps a name the user already typed over the file's", async () => {
    const { container } = await mount();
    setValue(nameField(container), "Mine");

    await openFile(
      container,
      JSON.stringify({ name: "Legacy", privateKey: NSEC }),
      "old-export.json"
    );
    await settle(() => keyField(container).value !== "");

    expect(nameField(container).value).toBe("Mine");
  });

  it("treats a plain text file as the key itself", async () => {
    const { container } = await mount();

    await openFile(container, `\n  ${HEX}  \n`, "key.txt");
    await settle(() => keyField(container).value !== "");

    expect(keyField(container).value).toBe(HEX);
  });

  it("treats JSON without a private key as raw input for the parser to judge", async () => {
    const { container } = await mount();
    setValue(nameField(container), "Recovered");

    await openFile(container, ' {"note":"x"} ', "notes.json");
    await settle(() => keyField(container).value !== "");
    expect(keyField(container).value).toBe('{"note":"x"}');

    await continueFromKeyStep(container);
    expect(container.textContent).toContain("That is not a valid private key.");
  });
});

describe("onboarding import opens encrypted backups", () => {
  it("asks for the backup passphrase and fills nothing until it is given", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();

    await openFile(container, await sealedBackup(), "ostrilo-backup-2026-09-13.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);

    expect(container.textContent).toContain(
      "Encrypted backup: ostrilo-backup-2026-09-13.json"
    );
    expect(keyField(container).value).toBe("");
    expect(button(container, "Open backup").disabled).toBe(true);
  });

  it("fails closed on the wrong passphrase", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();
    await openFile(container, await sealedBackup(), "ostrilo-backup.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);

    setValue(input(container, "#importBackupPassphrase"), "not-the-passphrase");
    await click(button(container, "Open backup"));
    await settle(() => alertText(container) !== "");

    expect(alertText(container)).toBe(BACKUP_DECRYPT_FAILURE_MESSAGE);
    expect(keyField(container).value).toBe("");
    expect(container.querySelector("#importBackupPassphrase")).not.toBeNull();
  });

  it("recovers the key into the input and drops the passphrase", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();
    await openFile(container, await sealedBackup(), "ostrilo-backup.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);

    setValue(input(container, "#importBackupPassphrase"), BACKUP_PASSPHRASE);
    await click(button(container, "Open backup"));
    await settle(() => container.querySelector("#importBackupPassphrase") === null);

    expect(keyField(container).value).toBe(NSEC);
    expect(nameField(container).value).toBe("From backup");
    expect(container.innerHTML).not.toContain(BACKUP_PASSPHRASE);
  });

  it("re-encrypts a recovered key under the new master password", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();
    await openFile(container, await sealedBackup(), "ostrilo-backup.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);
    setValue(input(container, "#importBackupPassphrase"), BACKUP_PASSPHRASE);
    await click(button(container, "Open backup"));
    await settle(() => keyField(container).value !== "");

    await continueFromKeyStep(container);
    enterPassword(container, PASSWORD);
    await importAndSettle(container);

    expect(background.sent("vault.import")).toEqual([
      { type: "vault.import", keyInput: NSEC, password: PASSWORD, label: "From backup" },
    ]);
    const onTheWire = JSON.stringify(background.requests);
    expect(onTheWire).not.toContain(BACKUP_PASSPHRASE);
  });

  it("keeps a name the user typed over the one sealed in the backup", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();
    setValue(nameField(container), "Mine");
    await openFile(container, await sealedBackup(), "ostrilo-backup.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);
    setValue(input(container, "#importBackupPassphrase"), BACKUP_PASSPHRASE);

    await click(button(container, "Open backup"));
    expect(button(container, "Opening").disabled).toBe(true);
    expect(button(container, "Cancel").disabled).toBe(true);
    await settle(() => keyField(container).value !== "");

    expect(keyField(container).value).toBe(NSEC);
    expect(nameField(container).value).toBe("Mine");
  });

  it("opens the file picker from a keyboard-reachable button", async () => {
    const { container } = await mount();
    const picker = input(container, "#file-upload");
    const opened: Event[] = [];
    picker.addEventListener("click", (event) => {
      event.preventDefault();
      opened.push(event);
    });

    await click(button(container, "Open a key file"));

    expect(opened).toHaveLength(1);
  });

  it("ignores a file picker that closes without a choice", async () => {
    const { container } = await mount();
    const picker = input(container, "#file-upload");
    Object.defineProperty(picker, "files", { value: [], configurable: true });

    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(() => true);

    expect(keyField(container).value).toBe("");
    expect(container.querySelector("p.text-destructive")).toBeNull();
  });

  it("forgets the file when the user cancels", CRYPTO_TIMEOUT, async () => {
    const { container } = await mount();
    await openFile(container, await sealedBackup(), "ostrilo-backup.json");
    await settle(() => container.querySelector("#importBackupPassphrase") !== null);
    setValue(input(container, "#importBackupPassphrase"), BACKUP_PASSPHRASE);

    await click(button(container, "Cancel"));

    expect(container.querySelector("#importBackupPassphrase")).toBeNull();
    expect(container.textContent).not.toContain("Encrypted backup:");
    expect(keyField(container).value).toBe("");
  });
});

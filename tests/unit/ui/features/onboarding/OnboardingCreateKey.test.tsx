/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingCreateKey } from "@/ui/features/onboarding/components/OnboardingCreateKey";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import {
  createKeyBackup,
  serializeKeyBackup,
} from "@/ui/features/onboarding/backup/key-backup-envelope";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { background } from "./fake-background";
import {
  alertText,
  button,
  captureDownloads,
  chooseFile,
  click,
  input,
  maybeButton,
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

let writeText: ReturnType<typeof vi.fn>;

async function mount() {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const view = render(
    <KeyManagerProvider>
      <OnboardingCreateKey onBack={onBack} onComplete={onComplete} />
    </KeyManagerProvider>
  );
  await settle(() => maybeButton(view.container, "Create Key")?.disabled === false);
  return { ...view, onBack, onComplete };
}

function fillInput(root: HTMLElement, name: string, password: string, confirm = password) {
  setValue(input(root, "#keyName"), name);
  setValue(input(root, "#password"), password);
  setValue(input(root, "#confirm-password"), confirm);
}

async function createAndSettle(root: HTMLElement) {
  await click(button(root, "Create Key"));
  await settle(
    () =>
      root.textContent?.includes("Backup Your Key") === true ||
      root.querySelector("#password")?.getAttribute("aria-invalid") === "true"
  );
}

async function reachRevealed(root: HTMLElement) {
  fillInput(root, "Everyday", PASSWORD);
  await createAndSettle(root);
  await click(button(root, "Reveal Private Key"));
  await settle(() => maybeButton(root, "Copy key") !== undefined);
}

function finish(root: HTMLElement) {
  return button(root, "Finish");
}

beforeEach(() => {
  silenceConsole();
  background.reset();
  background.respond("vault.reveal", () => ({
    ok: true,
    data: { nsec: NSEC, hex: HEX },
  }));
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("create key input step refuses to generate on bad input", () => {
  it("requires a password", async () => {
    const { container } = await mount();
    setValue(input(container, "#keyName"), "Everyday");

    await createAndSettle(container);

    expect(container.textContent).toContain("Password is required");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("refuses a confirmation that does not match", async () => {
    const { container } = await mount();
    fillInput(container, "Everyday", PASSWORD, `${PASSWORD}x`);

    await createAndSettle(container);

    expect(background.sent("vault.generate")).toHaveLength(0);
    expect(input(container, "#password").getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).not.toContain("Backup Your Key");
  });

  it("refuses a password the background policy rejects", async () => {
    const { container } = await mount();
    fillInput(container, "Everyday", "password1");

    await createAndSettle(container);

    expect(background.sent("vault.generate")).toHaveLength(0);
    expect(input(container, "#password").getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).not.toContain("Backup Your Key");
  });

  it("says the policy was not met when the verdict names no violation", async () => {
    const { container } = await mount();
    background.respond("crypto.evaluatePassword", () => ({
      ok: true,
      data: { acceptable: false, violations: [], requirements: [], score: 0, blocklistChecked: true },
    }));
    fillInput(container, "Everyday", PASSWORD);

    await createAndSettle(container);

    expect(container.textContent).toContain("Password does not meet the policy.");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("fails closed when the strength check cannot be reached", async () => {
    const { container } = await mount();
    background.fail("crypto.evaluatePassword", RPC_ERROR_CODES.TIMEOUT);
    fillInput(container, "Everyday", PASSWORD);

    await createAndSettle(container);

    expect(container.textContent).toContain("Could not validate password strength");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("requires a key name", async () => {
    const { container } = await mount();
    fillInput(container, "   ", PASSWORD);

    await createAndSettle(container);

    expect(container.textContent).toContain("Key name is required");
    expect(background.sent("vault.generate")).toHaveLength(0);
  });

  it("stays on the input step with the vault's error when generation fails", async () => {
    background.fail("vault.generate", RPC_ERROR_CODES.INVALID_PASSWORD);
    const { container } = await mount();
    fillInput(container, "Everyday", PASSWORD);

    await createAndSettle(container);

    expect(container.textContent).toContain("That password was not accepted.");
    expect(background.sent("vault.unlock")).toHaveLength(0);
    expect(button(container, "Create Key").disabled).toBe(false);
  });

  it("leaves the flow when the user goes back from the input step", async () => {
    const { container, onBack } = await mount();

    await click(button(container, "Back"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("create key generates, unlocks, and reveals through the vault", () => {
  it("sends the trimmed name and the password, then re-verifies it to reveal", async () => {
    const { container } = await mount();
    fillInput(container, "  Everyday  ", PASSWORD);

    await createAndSettle(container);
    await click(button(container, "Reveal Private Key"));
    await settle(() => maybeButton(container, "Copy key") !== undefined);

    expect(background.sent("vault.generate")).toEqual([
      { type: "vault.generate", password: PASSWORD, label: "Everyday" },
    ]);
    expect(background.sent("vault.unlock")).toEqual([
      { type: "vault.unlock", password: PASSWORD },
    ]);
    expect(background.sent("vault.reveal")).toEqual([
      { type: "vault.reveal", password: PASSWORD, keyId: undefined },
    ]);
  });
});

describe("create key backup step copies and transcribes", () => {
  it("falls back to the grouped transcription when the copy is refused", async () => {
    writeText.mockRejectedValue(new Error("Document is not focused"));
    const { container } = await mount();
    await reachRevealed(container);

    await click(button(container, "Copy key"));

    expect(alertText(container)).toContain("The copy did not happen");
    const panel = container.querySelector("[data-testid='nsec-transcription']");
    expect(panel?.textContent?.replace(/ /g, "")).toBe(NSEC);
  });

  it("overwrites the clipboard when the user clears it early", async () => {
    const { container } = await mount();
    await reachRevealed(container);
    await click(button(container, "Copy key"));
    expect(writeText).toHaveBeenLastCalledWith(NSEC);

    await click(button(container, "Clear now"));
    await settle(() => container.textContent?.includes("Clipboard cleared") === true);

    expect(writeText).toHaveBeenLastCalledWith("");
  });

  it("shows and hides the written-down form on request", async () => {
    const { container } = await mount();
    await reachRevealed(container);
    const panel = () => container.querySelector("[data-testid='nsec-transcription']");
    expect(panel()).toBeNull();

    await click(button(container, "Show it grouped for writing down"));
    expect(panel()).not.toBeNull();

    await click(button(container, "Hide the written-down form"));
    expect(panel()).toBeNull();
  });

  it("keeps Finish disabled when only the checkbox is ticked", async () => {
    const { container, onComplete } = await mount();
    await reachRevealed(container);

    await click(input(container, "#backupConfirm"));

    expect(input(container, "#backupConfirm").checked).toBe(true);
    expect(finish(container).disabled).toBe(true);
    await click(finish(container));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("create key backup verified by the file it just wrote", () => {
  async function saveBackup(root: HTMLElement) {
    await click(button(root, "Save encrypted backup"));
    setValue(input(root, "#backup-password"), BACKUP_PASSPHRASE);
    setValue(input(root, "#backup-confirm-password"), BACKUP_PASSPHRASE);
    await click(button(root, "Save file"));
    await settle(() => root.textContent?.includes("Encrypted backup saved") === true);
  }

  async function checkFile(root: HTMLElement, contents: string, passphrase: string) {
    await click(button(root, "Use the saved file"));
    await chooseFile(
      input(root, "#backupFile"),
      new File([contents], "ostrilo-backup.json", { type: "application/json" })
    );
    await settle(() => root.querySelector("label[for='backupFile']")?.textContent === "ostrilo-backup.json");
    setValue(input(root, "#backupFilePassphrase"), passphrase);
    await click(button(root, "Check file"));
    await settle(
      () =>
        root.textContent?.includes("Backup verified") === true ||
        alertText(root) !== ""
    );
  }

  it("enables Finish once the saved file re-opens with its passphrase", CRYPTO_TIMEOUT, async () => {
    const downloads = captureDownloads();
    const { container, onComplete } = await mount();
    await reachRevealed(container);
    expect(finish(container).disabled).toBe(true);

    await saveBackup(container);
    const [file] = await downloads.files();
    expect(file.contents).not.toContain(NSEC);
    expect(file.contents).not.toContain("Everyday");

    await checkFile(container, file.contents, BACKUP_PASSPHRASE);

    expect(container.textContent).toContain("Backup verified");
    expect(finish(container).disabled).toBe(false);

    await click(finish(container));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("refuses a backup that holds a different key", CRYPTO_TIMEOUT, async () => {
    captureDownloads();
    const { container } = await mount();
    await reachRevealed(container);
    await saveBackup(container);
    const other = serializeKeyBackup(
      await createKeyBackup(
        { nsec: `${NSEC.slice(0, -1)}q`, hex: HEX, name: "other" },
        BACKUP_PASSPHRASE
      )
    );

    await checkFile(container, other, BACKUP_PASSPHRASE);

    expect(alertText(container)).toBe("That backup holds a different key.");
    expect(finish(container).disabled).toBe(true);
  });

  it("switches back to the re-entry route after opening the file route", CRYPTO_TIMEOUT, async () => {
    captureDownloads();
    const { container } = await mount();
    await reachRevealed(container);
    await saveBackup(container);

    await click(button(container, "Use the saved file"));
    expect(container.querySelector("#backupVerification")).toBeNull();
    expect(button(container, "Check file").disabled).toBe(true);

    await click(button(container, "Re-enter the key"));
    expect(container.querySelector("#backupFile")).toBeNull();
    setValue(input(container, "#backupVerification"), NSEC.slice(-8));
    await click(button(container, "Check"));

    expect(finish(container).disabled).toBe(false);
  });

  it("drops the passphrase when the export panel is cancelled", async () => {
    const { container } = await mount();
    await reachRevealed(container);
    await click(button(container, "Save encrypted backup"));
    setValue(input(container, "#backup-password"), BACKUP_PASSPHRASE);

    await click(button(container, "Cancel"));

    expect(container.querySelector("#backup-password")).toBeNull();
    await click(button(container, "Save encrypted backup"));
    expect(input(container, "#backup-password").value).toBe("");
  });
});

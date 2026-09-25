/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupEncryptedExport } from "@/ui/features/onboarding/components/backup/BackupEncryptedExport";
import {
  BACKUP_DECRYPT_FAILURE_MESSAGE,
  KeyBackupError,
  openKeyBackup,
  parseKeyBackupEnvelope,
  type KeyBackupPayload,
} from "@/ui/features/onboarding/backup/key-backup-envelope";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { background } from "./fake-background";
import {
  alertText,
  button,
  captureDownloads,
  click,
  input,
  render,
  setValue,
  settle,
  silenceConsole,
  unmountAll,
} from "./dom";

vi.mock("wxt/browser", async () => (await import("./fake-background")).wxtBrowserModule);

const PAYLOAD: KeyBackupPayload = {
  nsec: "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
  hex: "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa",
  name: "Alice's everyday identity",
};
const PASSPHRASE = "Violet-Harbor-Quill-8472-otter";
const CRYPTO_TIMEOUT = { timeout: 60_000 };


let downloads: ReturnType<typeof captureDownloads>;

function mount(
  overrides: Partial<{
    getPayload: () => KeyBackupPayload | null;
    onSaved: () => void;
    onClose: () => void;
  }> = {}
) {
  const onSaved = overrides.onSaved ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();
  const { container } = render(
    <BackupEncryptedExport
      getPayload={overrides.getPayload ?? (() => ({ ...PAYLOAD }))}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
  return { container, onSaved, onClose };
}

function fields(container: HTMLElement) {
  return {
    passphrase: input(container, "#backup-password"),
    confirm: input(container, "#backup-confirm-password"),
  };
}

function enter(container: HTMLElement, passphrase: string, confirm = passphrase) {
  setValue(fields(container).passphrase, passphrase);
  setValue(fields(container).confirm, confirm);
}

async function saveAndSettle(container: HTMLElement) {
  await click(button(container, "Save file"));
  await settle(
    () =>
      container.querySelector("[role='status']") !== null ||
      alertText(container) !== ""
  );
}

beforeEach(() => {
  silenceConsole();
  background.reset();
  downloads = captureDownloads();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("encrypted backup export refuses to write without a passphrase", () => {
  it("keeps Save disabled and writes nothing while the passphrase is empty", async () => {
    const { container } = mount();
    const save = button(container, "Save file");

    expect(save.disabled).toBe(true);
    await click(save);

    expect(downloads.count()).toBe(0);
    expect(background.sent("crypto.evaluatePassword")).toHaveLength(0);
  });

  it("writes nothing when the confirmation does not match", async () => {
    const { container, onSaved } = mount();
    enter(container, PASSPHRASE, `${PASSPHRASE}-typo`);

    await click(button(container, "Save file"));

    expect(alertText(container)).toContain("Passphrases do not match.");
    expect(downloads.count()).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects a passphrase below the master-password floor and drops it", async () => {
    const { container, onSaved } = mount();
    enter(container, "password1");

    await saveAndSettle(container);

    expect(alertText(container)).not.toBe("");
    expect(alertText(container)).not.toContain("password1");
    expect(downloads.count()).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(fields(container).passphrase.value).toBe("");
    expect(fields(container).confirm.value).toBe("");
  });

  it("says the policy was not met when the verdict names no violation", async () => {
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
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(alertText(container)).toContain("Passphrase does not meet the policy.");
    expect(downloads.count()).toBe(0);
  });
});

describe("encrypted backup export writes a file only the passphrase opens", () => {
  it("writes an envelope that round-trips through the real decryption", CRYPTO_TIMEOUT, async () => {
    const { container, onSaved } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    const [file] = await downloads.files();
    expect(downloads.count()).toBe(1);
    expect(file.filename).toMatch(/^ostrilo-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const envelope = parseKeyBackupEnvelope(file.contents);
    expect(envelope).not.toBeNull();
    const recovered = await openKeyBackup(envelope!, PASSPHRASE);
    expect(recovered).toEqual(PAYLOAD);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("puts neither the key nor its name in the file or its filename", CRYPTO_TIMEOUT, async () => {
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    const [file] = await downloads.files();
    for (const secret of [PAYLOAD.nsec, PAYLOAD.hex, PAYLOAD.name, PASSPHRASE]) {
      expect(file.contents).not.toContain(secret);
      expect(file.filename).not.toContain(secret);
    }
    expect(file.contents).not.toContain("nsec1");
  });

  it("produces a file a wrong passphrase cannot open", CRYPTO_TIMEOUT, async () => {
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    const [file] = await downloads.files();
    const envelope = parseKeyBackupEnvelope(file.contents)!;
    await expect(openKeyBackup(envelope, `${PASSPHRASE}!`)).rejects.toThrow(
      new KeyBackupError(BACKUP_DECRYPT_FAILURE_MESSAGE)
    );
  });

  it("revokes the object URL and drops the passphrase once the file is written", CRYPTO_TIMEOUT, async () => {
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(downloads.liveUrls.size).toBe(0);
    expect(container.querySelector("[role='status']")?.textContent).toContain(
      "Encrypted backup saved"
    );
    expect(container.innerHTML).not.toContain(PASSPHRASE);

    await click(button(container, "Save another copy"));

    expect(fields(container).passphrase.value).toBe("");
    expect(fields(container).confirm.value).toBe("");
  });
});

describe("encrypted backup export fails closed", () => {
  it("aborts instead of writing an empty file when the reveal was dropped", async () => {
    const { container, onSaved } = mount({ getPayload: () => null });
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(alertText(container)).toContain(
      "The key is no longer available. Reveal it again."
    );
    expect(downloads.count()).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(fields(container).passphrase.value).toBe("");
  });

  it("reports a blocked download and drops the passphrase", CRYPTO_TIMEOUT, async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => {
        throw new Error("Downloads are blocked");
      },
    });
    const { container, onSaved } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(alertText(container)).toContain("Downloads are blocked");
    expect(onSaved).not.toHaveBeenCalled();
    expect(fields(container).passphrase.value).toBe("");
    expect(fields(container).confirm.value).toBe("");
    expect(button(container, "Save file").disabled).toBe(true);
  });

  it("falls back to a generic message when the failure is not an Error", CRYPTO_TIMEOUT, async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => {
        throw "blocked";
      },
    });
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(alertText(container)).toContain("Could not write the backup.");
  });

  it("drops the passphrase when the strength check cannot be reached", async () => {
    background.fail("crypto.evaluatePassword", RPC_ERROR_CODES.TIMEOUT);
    const { container } = mount();
    enter(container, PASSPHRASE);

    await saveAndSettle(container);

    expect(alertText(container)).not.toBe("");
    expect(alertText(container)).not.toContain(PASSPHRASE);
    expect(downloads.count()).toBe(0);
    expect(fields(container).passphrase.value).toBe("");
  });
});

describe("cancelling the export", () => {
  it("drops the passphrase and any error before closing", async () => {
    const { container, onClose } = mount();
    enter(container, PASSPHRASE, "different");
    await click(button(container, "Save file"));
    expect(alertText(container)).not.toBe("");

    await click(button(container, "Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fields(container).passphrase.value).toBe("");
    expect(fields(container).confirm.value).toBe("");
    expect(alertText(container)).toBe("");
    expect(downloads.count()).toBe(0);
  });
});

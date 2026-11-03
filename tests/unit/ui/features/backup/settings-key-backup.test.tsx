/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKeyBackup,
  serializeKeyBackup,
} from "@/ui/features/backup/key-backup-envelope";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import {
  button,
  captureDownloads,
  chooseFile,
  click,
  input,
  setValue,
  settle,
  silenceConsole,
} from "../onboarding/dom";
import {
  byLabel,
  confirmReauth,
  reauthDialog,
  render,
  unmountAll,
} from "../settings/settings-dom";

const NSEC = "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";
const HEX = "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
const OTHER_NSEC = "nsec1" + "q".repeat(58);
const OTHER_HEX = "00".repeat(32);
const MASTER = "master-password-for-the-test";
const PASSPHRASE = "Violet-Harbor-Quill-8472-otter";
const CRYPTO_TIMEOUT = { timeout: 60_000 };

const keyManager = vi.hoisted(() => ({
  isLocked: false,
  keys: [] as Array<Record<string, unknown>>,
  selectedUnlockedKey: undefined as { id: string } | undefined,
  selectKey: vi.fn(),
}));

const client = vi.hoisted(() => ({
  renameKey: vi.fn(),
  deleteKey: vi.fn(),
  revealKey: vi.fn(),
  markKeyBackupVerified: vi.fn(),
  listBackupStatuses: vi.fn(),
  subscribeKeyBackupChanged: vi.fn(() => () => {}),
  evaluatePasswordStrength: vi.fn(),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => keyManager,
}));
vi.mock("@/ui/hooks/useProfileMetadata", () => ({
  useProfileMetadata: () => ({ profiles: new Map() }),
}));
vi.mock("@/infrastructure/messaging/client", () => client);

import { KeyBackupDialog } from "@/ui/features/backup/components/KeyBackupDialog";
import { KeysIdentitiesTab } from "@/ui/features/settings/components/KeysIdentitiesTab";

const TRADING = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Trading",
  publicKeyBech32: "npub1trading00000000000000000000000000000000",
  publicKeyHex: "bb",
  isUnreadable: false,
};

let downloads: ReturnType<typeof captureDownloads>;

beforeEach(() => {
  silenceConsole();
  downloads = captureDownloads();
  keyManager.isLocked = false;
  keyManager.keys = [{ ...TRADING, id: "00000000-0000-4000-8000-000000000001", label: "Main" }, TRADING];
  keyManager.selectedUnlockedKey = { id: "00000000-0000-4000-8000-000000000001" };
  client.revealKey.mockReset().mockResolvedValue({ nsec: NSEC, hex: HEX });
  client.markKeyBackupVerified.mockReset().mockResolvedValue(null);
  client.listBackupStatuses.mockReset().mockResolvedValue([
    { keyId: TRADING.id, state: "pending", at: 1 },
  ]);
  client.evaluatePasswordStrength.mockReset().mockResolvedValue({
    acceptable: true,
    violations: [],
    requirements: [],
    score: 4,
    blocklistChecked: true,
  });
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')!;

async function startBackup(container: HTMLElement) {
  await click(byLabel(container, "Back up Trading"));
  await confirmReauth(MASTER);
}

async function saveFile() {
  setValue(input(dialog(), "#backup-password"), PASSPHRASE);
  setValue(input(dialog(), "#backup-confirm-password"), PASSPHRASE);
  await click(button(dialog(), "Save file"));
  await settle(() => downloads.count() === 1);
  const [file] = await downloads.files();
  return file;
}

async function checkFile(file: { contents: string }, passphrase = PASSPHRASE) {
  await chooseFile(
    input(dialog(), "#backupFile"),
    new File([file.contents], "backup.json", { type: "application/json" })
  );
  setValue(input(dialog(), "#backupFilePassphrase"), passphrase);
  await click(button(dialog(), "Check file"));
  await settle(
    () =>
      dialog().textContent?.includes("Backup verified") === true ||
      dialog().querySelector("[role='alert']") !== null
  );
}

describe("backing up a key from Settings", () => {
  it("marks a pending key and asks for the password with the key's id", async () => {
    const container = render(<KeysIdentitiesTab />);
    await act(async () => {});

    expect(container.textContent).toContain("No backup");

    await click(byLabel(container, "Back up Trading"));
    expect(client.revealKey).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain("Back up “Trading”.");

    await confirmReauth(MASTER);
    expect(client.revealKey).toHaveBeenCalledExactlyOnceWith(MASTER, TRADING.id);
  });

  it("does not reveal or open anything when the password prompt is cancelled", async () => {
    const container = render(<KeysIdentitiesTab />);
    await click(byLabel(container, "Back up Trading"));
    await click(button(reauthDialog()!, "Cancel"));

    expect(client.revealKey).not.toHaveBeenCalled();
    expect(reauthDialog()).toBeNull();
  });

  it("writes an encrypted file that opens to this key, then records the backup", CRYPTO_TIMEOUT, async () => {
    const container = render(<KeysIdentitiesTab />);
    await startBackup(container);
    expect(dialog().textContent).toContain("Back up “Trading”");

    const file = await saveFile();
    // Sealed, not merely relocated.
    expect(file.contents).not.toContain(NSEC);
    expect(file.contents).not.toContain(HEX);
    expect(file.filename).not.toContain("Trading");
    expect(client.markKeyBackupVerified).not.toHaveBeenCalled();

    // Only the file route is offered: the key was never shown.
    expect(dialog().textContent).not.toContain("Re-enter the key");
    client.listBackupStatuses.mockClear();
    await checkFile(file);

    expect(dialog().textContent).toContain("Backup verified");
    expect(client.markKeyBackupVerified).toHaveBeenCalledExactlyOnceWith(TRADING.id);
    expect(client.listBackupStatuses).toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(NSEC);

    await click(button(dialog(), "Done"));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("records nothing when the file the user checks holds a different key", CRYPTO_TIMEOUT, async () => {
    const container = render(<KeysIdentitiesTab />);
    await startBackup(container);
    await saveFile();

    const foreign = await createKeyBackup(
      { nsec: OTHER_NSEC, hex: OTHER_HEX, name: "Someone else" },
      PASSPHRASE
    );
    await checkFile({ contents: serializeKeyBackup(foreign) });

    expect(dialog().textContent).toContain("That backup holds a different key.");
    expect(client.markKeyBackupVerified).not.toHaveBeenCalled();
  });

  it("records nothing for a wrong passphrase", CRYPTO_TIMEOUT, async () => {
    const container = render(<KeysIdentitiesTab />);
    await startBackup(container);
    const file = await saveFile();

    await checkFile(file, "Wrong-Passphrase-Entirely-2026!");

    expect(dialog().querySelector("[role='alert']")).not.toBeNull();
    expect(dialog().textContent).not.toContain("Backup verified");
    expect(client.markKeyBackupVerified).not.toHaveBeenCalled();
  });

  it("does not claim success when the status cannot be recorded", CRYPTO_TIMEOUT, async () => {
    client.markKeyBackupVerified.mockRejectedValue(new Error("rpc:backup.markVerified:transport_error"));
    const container = render(<KeysIdentitiesTab />);
    await startBackup(container);
    const file = await saveFile();

    await chooseFile(
      input(dialog(), "#backupFile"),
      new File([file.contents], "backup.json")
    );
    setValue(input(dialog(), "#backupFilePassphrase"), PASSPHRASE);
    await click(button(dialog(), "Check file"));
    await settle(() => dialog().querySelector("[role='alert']") !== null);

    expect(dialog().textContent).not.toContain("Backup verified");
    expect(dialog().textContent).toContain("could not record it");
  });

  it("says the vault locked, and records nothing, when it locks before the record is written", CRYPTO_TIMEOUT, async () => {
    const locked = Object.assign(new Error("rpc:backup.markVerified:locked"), {
      errorCode: RPC_ERROR_CODES.LOCKED,
    });
    client.markKeyBackupVerified.mockRejectedValue(locked);
    const container = render(<KeysIdentitiesTab />);
    await startBackup(container);
    const file = await saveFile();

    await chooseFile(
      input(dialog(), "#backupFile"),
      new File([file.contents], "backup.json")
    );
    setValue(input(dialog(), "#backupFilePassphrase"), PASSPHRASE);
    await click(button(dialog(), "Check file"));
    await settle(() => dialog().querySelector("[role='alert']") !== null);

    expect(dialog().textContent).toContain("The vault locked");
    expect(dialog().textContent).not.toContain("Backup verified");
  });
});

describe("the backup dialog when the vault locks", () => {
  it("stops the flow, says why, and offers no way to continue", () => {
    render(
      <KeyBackupDialog
        target={{ id: TRADING.id, label: "Trading" }}
        getPayload={() => null}
        lockedMidBackup
        onRecorded={vi.fn()}
        onVaultLocked={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(dialog().textContent).toContain("The vault locked, so the backup was stopped");
    expect(dialog().textContent).toContain("Nothing was recorded as backed up");
    expect(dialog().querySelector("#backup-password")).toBeNull();
    expect(dialog().querySelector("#backupFile")).toBeNull();
    expect(client.markKeyBackupVerified).not.toHaveBeenCalled();
  });
});

describe("a backup requested by the Home banner", () => {
  it("opens the same password step for that key, and acts on the request once", async () => {
    const handled = vi.fn();
    const container = render(
      <KeysIdentitiesTab backupRequestKeyId={TRADING.id} onBackupRequestHandled={handled} />
    );
    await act(async () => {});

    expect(reauthDialog()?.textContent).toContain("Back up “Trading”.");
    expect(handled).toHaveBeenCalledTimes(1);

    await confirmReauth(MASTER);
    expect(client.revealKey).toHaveBeenCalledWith(MASTER, TRADING.id);
    expect(dialog().textContent).toContain("Back up “Trading”");
    expect(container.textContent).toContain("Trading");
  });

  it("ignores a request naming a key the vault does not hold", async () => {
    const handled = vi.fn();
    render(<KeysIdentitiesTab backupRequestKeyId="no-such-key" onBackupRequestHandled={handled} />);
    await act(async () => {});

    expect(reauthDialog()).toBeNull();
    expect(client.revealKey).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the page was not opened for a backup", async () => {
    render(<KeysIdentitiesTab />);
    await act(async () => {});

    expect(reauthDialog()).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  byLabel,
  cancelReauth,
  click,
  confirmReauth,
  flush,
  pressKey,
  reauthDialog,
  render,
  typeInto,
  unmountAll,
} from "./settings-dom";

const keyManager = vi.hoisted(() => ({
  keys: [] as Array<{
    id: string;
    label: string;
    publicKeyBech32: string;
    publicKeyHex: string;
  }>,
  selectedUnlockedKey: undefined as { id: string } | undefined,
  selectKey: vi.fn(),
}));

const client = vi.hoisted(() => ({
  renameKey: vi.fn(),
  deleteKey: vi.fn(),
  evaluatePasswordStrength: vi.fn(),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => keyManager,
}));

vi.mock("@/ui/hooks/useProfileMetadata", () => ({
  useProfileMetadata: () => ({ profiles: new Map() }),
}));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("@/ui/components/dialogs/CreateKeyForm", () => ({
  CreateKeyForm: ({
    onBack,
    onSuccess,
  }: {
    onBack: () => void;
    onSuccess: () => void;
  }) => (
    <div>
      <p>Create form</p>
      <button type="button" onClick={onBack}>
        Back from create
      </button>
      <button type="button" onClick={onSuccess}>
        Finish create
      </button>
    </div>
  ),
}));

vi.mock("@/ui/components/dialogs/ImportKeyForm", () => ({
  ImportKeyForm: ({
    onBack,
    onSuccess,
  }: {
    onBack: () => void;
    onSuccess: () => void;
  }) => (
    <div>
      <p>Import form</p>
      <button type="button" onClick={onBack}>
        Back from import
      </button>
      <button type="button" onClick={onSuccess}>
        Finish import
      </button>
    </div>
  ),
}));

import { KeysIdentitiesTab } from "@/ui/features/settings/components/KeysIdentitiesTab";

const MAIN = {
  id: "key-main",
  label: "Main",
  publicKeyBech32: "npub1main0000000000000000000000000000000000000",
  publicKeyHex: "aa",
};
const TRADING = {
  id: "key-trading",
  label: "Trading",
  publicKeyBech32: "npub1trading00000000000000000000000000000000",
  publicKeyHex: "bb",
};

beforeEach(() => {
  keyManager.keys = [MAIN, TRADING];
  keyManager.selectedUnlockedKey = { id: MAIN.id };
  keyManager.selectKey.mockReset().mockResolvedValue(undefined);
  client.renameKey.mockReset().mockResolvedValue(undefined);
  client.deleteKey.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("KeysIdentitiesTab", () => {
  it("counts the keys in the vault in the header", () => {
    const container = render(<KeysIdentitiesTab />);
    expect(container.textContent).toContain("2 keys in this vault");

    unmountAll();
    keyManager.keys = [MAIN];
    const single = render(<KeysIdentitiesTab />);
    expect(single.textContent).toContain("One key in this vault");
  });

  it("asks for the password before deleting and names the key and consequence", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(byLabel(container, "Delete Trading"));

    expect(client.deleteKey).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain("Delete “Trading”.");
    expect(reauthDialog()?.textContent).toContain(
      "If this key is not backed up, the identity is gone for good."
    );
  });

  it("deletes the key with the password the user re-entered", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(byLabel(container, "Delete Trading"));
    await confirmReauth("correct horse");

    expect(client.deleteKey).toHaveBeenCalledTimes(1);
    expect(client.deleteKey).toHaveBeenCalledWith("key-trading", "correct horse");
    expect(reauthDialog()).toBeNull();
  });

  it("deletes nothing when the password dialog is cancelled", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(byLabel(container, "Delete Trading"));
    await cancelReauth();

    expect(client.deleteKey).not.toHaveBeenCalled();
    expect(reauthDialog()).toBeNull();
    expect(container.textContent).toContain("Trading");
  });

  it("keeps the dialog open with the background's message when the password is refused", async () => {
    client.deleteKey.mockRejectedValueOnce(new Error("Incorrect password"));
    const container = render(<KeysIdentitiesTab />);

    await click(byLabel(container, "Delete Trading"));
    await confirmReauth("wrong");

    expect(reauthDialog()?.textContent).toContain("Incorrect password");

    await confirmReauth("right");

    expect(client.deleteKey).toHaveBeenLastCalledWith("key-trading", "right");
    expect(reauthDialog()).toBeNull();
  });

  it("makes a non-active key the signer when Set Active is pressed", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(buttonByText(container, "Set Active"));

    expect(keyManager.selectKey).toHaveBeenCalledWith("key-trading");
  });

  it("stays usable when making a key active fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    keyManager.selectKey.mockRejectedValueOnce(new Error("locked"));
    const container = render(<KeysIdentitiesTab />);

    await click(buttonByText(container, "Set Active"));
    await flush();

    expect(error).toHaveBeenCalledWith(
      "Failed to set active key:",
      expect.any(Error)
    );
    expect(buttonByText(container, "Set Active").disabled).toBe(false);
  });

  it("renames a key over RPC with the edited label", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(byLabel(container, "Rename Trading"));
    const input = byLabel<HTMLInputElement>(container, "New label for Trading");
    typeInto(input, "Savings");
    await click(byLabel(container, "Save label for Trading"));
    await flush();

    expect(client.renameKey).toHaveBeenCalledWith("key-trading", "Savings");
    expect(container.querySelector('[aria-label="New label for Trading"]')).toBeNull();
  });

  it("walks the add-key dialog from choice to create, back, to import and closes on success", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(buttonByText(container, "Add Key"));
    const dialog = () => document.body.querySelector('[role="dialog"]')!;
    expect(dialog().textContent).toContain(
      "Choose how to add a new key to your vault"
    );

    await click(buttonByText(dialog(), "Create New Key"));
    expect(dialog().textContent).toContain("Generate a new Nostr key pair");
    expect(dialog().textContent).toContain("Create form");

    await click(buttonByText(dialog(), "Back from create"));
    expect(dialog().textContent).toContain(
      "Choose how to add a new key to your vault"
    );

    await click(buttonByText(dialog(), "Import Existing Key"));
    expect(dialog().textContent).toContain(
      "Import an existing Nostr private key"
    );

    await click(buttonByText(dialog(), "Finish import"));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("closes the add-key dialog on Escape", async () => {
    const container = render(<KeysIdentitiesTab />);

    await click(buttonByText(container, "Add Key"));
    await click(buttonByText(document.body.querySelector('[role="dialog"]')!, "Create New Key"));
    await click(buttonByText(document.body.querySelector('[role="dialog"]')!, "Finish create"));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await click(buttonByText(container, "Add Key"));
    pressKey(document.body.querySelector('[role="dialog"]')!, "Escape");
    await flush();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KeySelectorCard,
  type KeyRecord,
} from "@/ui/features/settings/components/shared";
import {
  byLabel,
  click,
  flush,
  pressKey,
  render,
  typeInto,
  unmountAll,
} from "./settings-dom";

const MAIN: KeyRecord = {
  id: "key-main",
  label: "Main",
  publicKeyBech32: "npub1ppgfek6aabcdefghijklmnopqrstuvwxyz772ha9",
  publicKeyHex: "aa",
};
const SPARE: KeyRecord = {
  id: "key-spare",
  label: "Spare",
  publicKeyBech32: "npub1sparexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx0001",
  publicKeyHex: "bb",
};

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  unmountAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("KeySelectorCard", () => {
  it("shows the relay profile name over the label and middle-truncates the npub", () => {
    const container = render(
      <KeySelectorCard
        keys={[MAIN, SPARE]}
        selectedKeyId="key-main"
        profiles={
          new Map([
            ["aa", { display_name: "Alice" }],
            ["bb", { name: "bob" }],
          ])
        }
      />
    );

    const rows = container.querySelectorAll("li");
    expect(rows[0].textContent).toContain("Alice");
    expect(rows[0].textContent).toContain("Active");
    expect(rows[0].textContent).toContain("npub1ppgfek6…772ha9");
    expect(rows[1].textContent).toContain("bob");
    expect(rows[1].textContent).not.toContain("Active");
  });

  it("names a key with no label or profile as unnamed", () => {
    const container = render(
      <KeySelectorCard
        keys={[{ ...MAIN, label: "" }]}
        profiles={new Map()}
      />
    );

    expect(container.textContent).toContain("Unnamed Key");
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copy public key for Unnamed Key"
    );
  });

  it("reports an unreadable record instead of rendering an npub for it", () => {
    const container = render(
      <KeySelectorCard
        keys={[{ ...MAIN, isUnreadable: true }]}
        profiles={new Map()}
      />
    );

    expect(container.textContent).toContain(
      "Unreadable record: stored public key is not valid"
    );
    expect(container.textContent).not.toContain("npub1");
    expect(
      container.querySelector('[aria-label="Copy public key for Main"]')
    ).toBeNull();
  });

  it("copies the full npub and clears the Copied status after a moment", async () => {
    vi.useFakeTimers();
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} />
    );

    await click(byLabel(container, "Copy public key for Main"));

    expect(writeText).toHaveBeenCalledWith(MAIN.publicKeyBech32);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Copied"
    );

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("claims nothing was copied when the clipboard refuses", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} />
    );

    await click(byLabel(container, "Copy public key for Main"));
    await flush();

    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("saves a rename on Enter with the typed label", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} onRename={onRename} />
    );

    await click(byLabel(container, "Rename Main"));
    const input = byLabel<HTMLInputElement>(container, "New label for Main");
    expect(input.value).toBe("Main");

    typeInto(input, "Daily");
    pressKey(input, "Enter");
    await flush();

    expect(onRename).toHaveBeenCalledWith("key-main", "Daily");
    expect(container.querySelector('[aria-label="New label for Main"]')).toBeNull();
  });

  it("discards a rename on Escape and on Cancel without saving", async () => {
    const onRename = vi.fn();
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} onRename={onRename} />
    );

    await click(byLabel(container, "Rename Main"));
    typeInto(byLabel<HTMLInputElement>(container, "New label for Main"), "X");
    pressKey(byLabel(container, "New label for Main"), "Escape");
    expect(container.querySelector('[aria-label="New label for Main"]')).toBeNull();

    await click(byLabel(container, "Rename Main"));
    await click(byLabel(container, "Cancel editing Main"));

    expect(onRename).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Main");
    expect(container.querySelector("input")).toBeNull();
  });

  it("keeps the editor open and alerts when the rename is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onRename = vi.fn().mockRejectedValue(new Error("nope"));
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} onRename={onRename} />
    );

    await click(byLabel(container, "Rename Main"));
    typeInto(byLabel<HTMLInputElement>(container, "New label for Main"), "Daily");
    await click(byLabel(container, "Save label for Main"));
    await flush();

    expect(alert).toHaveBeenCalledWith("Failed to rename key. Please try again.");
    expect(
      byLabel<HTMLInputElement>(container, "New label for Main").value
    ).toBe("Daily");
  });

  it("hands the key id to the delete handler when more than one key exists", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const container = render(
      <KeySelectorCard
        keys={[MAIN, SPARE]}
        selectedKeyId="key-main"
        profiles={new Map()}
        onDelete={onDelete}
      />
    );

    const deleteMain = byLabel<HTMLButtonElement>(container, "Delete Main");
    expect(deleteMain.disabled).toBe(false);
    expect(deleteMain.title).toBe("");
    await click(byLabel(container, "Delete Spare"));

    expect(onDelete).toHaveBeenCalledWith("key-spare");
  });

  it("alerts when the delete handler fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onDelete = vi.fn().mockRejectedValue(new Error("boom"));
    const container = render(
      <KeySelectorCard keys={[MAIN, SPARE]} profiles={new Map()} onDelete={onDelete} />
    );

    await click(byLabel(container, "Delete Spare"));
    await flush();

    expect(alert).toHaveBeenCalledWith("Failed to delete key. Please try again.");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("explains why the only key cannot be deleted and ignores the press", async () => {
    const onDelete = vi.fn();
    const container = render(
      <KeySelectorCard keys={[MAIN]} profiles={new Map()} onDelete={onDelete} />
    );

    const button = byLabel<HTMLButtonElement>(container, "Delete Main");
    expect(button.title).toBe("The only key in the vault cannot be deleted.");
    await click(button);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("offers no management buttons when no handlers are supplied", () => {
    const container = render(
      <KeySelectorCard keys={[MAIN, SPARE]} selectedKeyId="key-main" profiles={new Map()} />
    );

    const labels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? button.textContent
    );
    expect(labels).toEqual([
      "Copy public key for Main",
      "Copy public key for Spare",
    ]);
  });
});

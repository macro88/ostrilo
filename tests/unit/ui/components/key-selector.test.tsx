/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileMetadata } from "@/domain/profile/types";
import type { AvatarRow } from "@/domain/profile/avatar";
import type { UIKeyInfo } from "@/ui/state/KeyManagerContext";

const keyManager = vi.hoisted(() => ({
  keys: [] as UIKeyInfo[],
  selectedUnlockedKey: null as UIKeyInfo | null,
  selectKey: vi.fn<(id: string) => Promise<void>>(),
}));

const profileState = vi.hoisted(() => ({
  profiles: new Map<string, ProfileMetadata>(),
  requested: [] as string[][],
}));

const avatarState = vi.hoisted(() => ({
  rows: new Map<string, AvatarRow>(),
  requested: [] as Array<string | null>,
}));

vi.mock("@/ui/hooks/useOwnAvatar", () => ({
  useOwnAvatar: (pubkey: string | null) => {
    avatarState.requested.push(pubkey);
    return pubkey ? (avatarState.rows.get(pubkey) ?? null) : null;
  },
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => keyManager,
}));

vi.mock("@/ui/hooks/useProfileMetadata", () => ({
  useProfileMetadata: (pubkeys: string[]) => {
    profileState.requested.push(pubkeys);
    return { profiles: profileState.profiles, isLoading: false };
  },
}));

const { KeySelector } = await import("@/ui/components/layout/KeySelector");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: NoopResizeObserver,
    });
  }
});

function makeKey(id: string, label: string, fill: string): UIKeyInfo {
  return {
    id,
    label,
    publicKeyHex: fill.repeat(64),
    publicKeyBech32: `npub1${fill.repeat(58)}`,
    isUnreadable: false,
    createdAt: 1_735_689_600,
  } as UIKeyInfo;
}

const MAIN = makeKey("key-main", "Main", "a");
const ALT = makeKey("key-alt", "Alt", "b");
const THIRD = makeKey("key-third", "", "c");

let container: HTMLDivElement;
let root: Root;

function mount(onAddKey?: () => void) {
  act(() => {
    root.render(<KeySelector onAddKey={onAddKey} />);
  });
}

function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Select active key"]'
  );
  if (!button) throw new Error("trigger not rendered");
  return button;
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
}

function key(target: Element, keyName: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true })
    );
  });
}

async function arrow(target: Element, keyName: string) {
  key(target, keyName);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function open() {
  trigger().focus();
  key(trigger(), "Enter");
}

beforeEach(() => {
  keyManager.keys = [MAIN, ALT, THIRD];
  keyManager.selectedUnlockedKey = MAIN;
  keyManager.selectKey.mockReset().mockResolvedValue(undefined);
  profileState.profiles = new Map();
  profileState.requested = [];
  avatarState.rows = new Map();
  avatarState.requested = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("KeySelector trigger", () => {
  it("renders nothing while no key is unlocked", () => {
    keyManager.selectedUnlockedKey = null;
    mount();
    expect(container.innerHTML).toBe("");
  });

  it("names the active key and announces a menu", () => {
    mount();
    const button = trigger();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    const heading = container.querySelector("h2");
    const labelledBy = heading?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Main");
  });

  it("prefers the published display name, then name, then label", () => {
    profileState.profiles = new Map([
      [MAIN.publicKeyHex, { display_name: "Alice", name: "alice" }],
      [ALT.publicKeyHex, { name: "bob" }],
    ]);
    mount();
    expect(trigger().textContent).toContain("Alice");

    open();
    const labels = options().map((option) => option.getAttribute("aria-label"));
    expect(labels[0]).toMatch(/^Alice - npub1aaaaaaa\.\.\.aaaa \(currently selected\)$/);
    expect(labels[1]).toMatch(/^bob - /);
    expect(labels[2]).toMatch(/^Unnamed Key - npub1ccccccc\.\.\.cccc$/);
  });

  it("names a key whose public key cannot be read, with its ID, instead of calling it Unnamed", () => {
    keyManager.selectedUnlockedKey = { ...MAIN, label: "Unnamed", publicKeyBech32: "", isUnreadable: true };
    keyManager.keys = [keyManager.selectedUnlockedKey, ALT];
    mount();

    expect(trigger().textContent).toContain("Unreadable key");
    expect(trigger().textContent).not.toContain("Unnamed");
    open();
    const first = options()[0].getAttribute("aria-label");
    expect(first).toContain(`ID ${MAIN.id.slice(0, 8)}`);
    expect(first).toContain("(currently selected)");
  });

  it("asks for the profile of every key in the vault", () => {
    mount();
    expect(profileState.requested.at(-1)).toEqual([
      MAIN.publicKeyHex,
      ALT.publicKeyHex,
      THIRD.publicKeyHex,
    ]);
  });

  it("shows the local seal initial and never a relay-chosen picture", () => {
    profileState.profiles = new Map([
      [MAIN.publicKeyHex, { name: "zed", picture: "https://relay.example/a.png" }],
    ]);
    mount();
    expect(trigger().textContent?.startsWith("Z")).toBe(true);
    open();
    expect(document.querySelector("img")).toBeNull();
  });
});

// A real 1x1 PNG, so the stored-copy policy accepts it.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function copyFor(key: UIKeyInfo): AvatarRow {
  return {
    pubkey: key.publicKeyHex,
    dataUrl: PNG_DATA_URL,
    sourceUrl: "https://images.example/a.png",
    at: 1,
  };
}

describe("KeySelector header avatar", () => {
  it("shows the selected key's own local copy, named for the identity", () => {
    avatarState.rows = new Map([[MAIN.publicKeyHex, copyFor(MAIN)]]);
    mount();

    const img = trigger().querySelector("img");
    expect(img?.getAttribute("src")).toBe(PNG_DATA_URL);
    expect(img?.getAttribute("alt")).toBe("Main");
    expect(img?.getAttribute("width")).toBe("28");
    expect(img?.getAttribute("height")).toBe("28");
  });

  it("keeps the seal initial until the picture loads, then hides it so a transparent picture is shown as made", () => {
    avatarState.rows = new Map([[MAIN.publicKeyHex, copyFor(MAIN)]]);
    mount();
    expect(trigger().textContent?.startsWith("M")).toBe(true);

    act(() => {
      trigger().querySelector("img")!.dispatchEvent(new Event("load"));
    });
    expect(trigger().querySelector("img")).not.toBeNull();
    expect(trigger().querySelector(".seal")?.textContent ?? "").not.toContain("M");
  });

  it("keeps the seal initial when the copy fails to decode", () => {
    avatarState.rows = new Map([[MAIN.publicKeyHex, copyFor(MAIN)]]);
    mount();
    act(() => {
      trigger().querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().querySelector(".seal")?.textContent).toBe("M");
  });

  it("looks up only the selected key's public key", () => {
    mount();
    expect(avatarState.requested.at(-1)).toBe(MAIN.publicKeyHex);
  });

  it("falls back to the seal initial when there is no copy", () => {
    mount();
    expect(trigger().querySelector("img")).toBeNull();
    expect(trigger().textContent?.startsWith("M")).toBe(true);
  });

  it("shows no image for an unreadable key and asks for no copy", () => {
    keyManager.selectedUnlockedKey = { ...MAIN, isUnreadable: true };
    keyManager.keys = [keyManager.selectedUnlockedKey];
    avatarState.rows = new Map([[MAIN.publicKeyHex, copyFor(MAIN)]]);
    mount();
    expect(avatarState.requested.at(-1)).toBeNull();
    expect(trigger().querySelector("img")).toBeNull();
  });

  it("refuses a copy whose source is not a data URL", () => {
    avatarState.rows = new Map([
      [MAIN.publicKeyHex, { ...copyFor(MAIN), dataUrl: "https://relay.example/a.png" }],
    ]);
    mount();
    expect(trigger().querySelector("img")).toBeNull();
    expect(document.querySelector('img[src^="http"]')).toBeNull();
  });

  it("keeps the list rows as seals even when the selected key has a copy", () => {
    avatarState.rows = new Map([[MAIN.publicKeyHex, copyFor(MAIN)]]);
    mount();
    open();
    expect(document.querySelector('[role="menu"] img')).toBeNull();
  });
});

describe("KeySelector menu on the rendered DOM", () => {
  it("toggles aria-expanded as the list opens and closes", () => {
    mount();
    expect(menu()).toBeNull();

    open();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const list = menu();
    expect(list?.getAttribute("aria-label")).toBe("Available keys");

    key(document.activeElement ?? list!, "Escape");
    expect(menu()).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("marks exactly the active key as the checked item", () => {
    mount();
    open();
    const selected = options().map((option) => option.getAttribute("aria-checked"));
    expect(selected).toEqual(["true", "false", "false"]);
  });

  it("keeps every row a menu item, so the Add Key action is a legal child", () => {
    mount(vi.fn());
    open();
    const list = menu()!;
    expect(document.querySelector('[role="listbox"], [role="option"]')).toBeNull();
    const add = list.querySelector('[aria-label="Add new key"]');
    expect(add?.getAttribute("role")).toBe("menuitem");
    expect(list.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
  });

  it("moves focus between options with the arrow keys", async () => {
    mount();
    open();
    const [first, second, third] = options();
    expect(document.activeElement).toBe(first);

    await arrow(first, "ArrowDown");
    expect(document.activeElement).toBe(second);

    await arrow(second, "ArrowDown");
    expect(document.activeElement).toBe(third);

    await arrow(third, "ArrowUp");
    expect(document.activeElement).toBe(second);
  });

  it("opens with ArrowDown from the trigger", () => {
    mount();
    trigger().focus();
    key(trigger(), "ArrowDown");
    expect(menu()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("switches to the key chosen with Enter and closes the list", async () => {
    mount();
    open();
    const second = options()[1];
    await arrow(options()[0], "ArrowDown");
    expect(document.activeElement).toBe(second);
    key(second, "Enter");
    await flush();

    expect(keyManager.selectKey).toHaveBeenCalledWith("key-alt");
    expect(menu()).toBeNull();
  });

  it("does not ask to switch to the key that is already active", async () => {
    mount();
    open();
    key(options()[0], "Enter");
    await flush();
    expect(keyManager.selectKey).not.toHaveBeenCalled();
  });

  it("disables the trigger while a switch is in flight", async () => {
    let finish: () => void = () => {};
    keyManager.selectKey.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    mount();
    open();
    act(() => {
      options()[1].click();
    });
    expect(trigger().disabled).toBe(true);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(trigger().disabled).toBe(false);
  });

  it("re-enables the trigger when the switch fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    keyManager.selectKey.mockRejectedValue(new Error("vault locked"));
    mount();
    open();
    act(() => {
      options()[2].click();
    });
    await flush();
    expect(trigger().disabled).toBe(false);
    error.mockRestore();
  });
});

describe("KeySelector add-key entry", () => {
  it("offers Add Key only when the host can handle it", () => {
    mount();
    open();
    expect(document.querySelector('[aria-label="Add new key"]')).toBeNull();
  });

  it("calls the host when Add Key is chosen", () => {
    const onAddKey = vi.fn();
    mount(onAddKey);
    open();
    const add = document.querySelector<HTMLElement>('[aria-label="Add new key"]');
    expect(add?.getAttribute("role")).toBe("menuitem");
    act(() => {
      add!.click();
    });
    expect(onAddKey).toHaveBeenCalledTimes(1);
    expect(keyManager.selectKey).not.toHaveBeenCalled();
  });
});

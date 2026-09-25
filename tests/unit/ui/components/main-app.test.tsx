/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIKeyInfo } from "@/ui/state/KeyManagerContext";
import type { TabKey } from "@/ui/components/navigation/BottomTabs";

const listeners = vi.hoisted(() => new Set<(message: unknown) => void>());

const state = vi.hoisted(() => ({
  needsOnboarding: false,
  isLocked: false,
  isLoading: false,
  lock: vi.fn(),
  refreshKeys: vi.fn(),
  selectKey: vi.fn(),
  keys: [] as UIKeyInfo[],
  selectedUnlockedKey: null as UIKeyInfo | null,
  homeNavigate: null as ((tab: TabKey) => void) | null,
  addKeyDialog: null as {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
  } | null,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn(async () => ({ ok: true, data: null })),
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
      },
    },
  },
}));

vi.mock("@/ui/features/onboarding/hooks/useOnboarding", () => ({
  useOnboarding: () => ({ needsOnboarding: state.needsOnboarding }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({
    isLocked: state.isLocked,
    isLoading: state.isLoading,
    lockAt: undefined,
    lock: state.lock,
    refreshKeys: state.refreshKeys,
    selectKey: state.selectKey,
    keys: state.keys,
    selectedUnlockedKey: state.selectedUnlockedKey,
  }),
}));

vi.mock("@/ui/hooks/useAppSettings", () => ({
  useAppSettings: () => ({ settings: { autoLockMinutes: 15 }, isLoading: false }),
}));

vi.mock("@/ui/hooks/useProfileMetadata", () => ({
  useProfileMetadata: () => ({ profiles: new Map(), isLoading: false }),
}));

vi.mock("@/ui/features/onboarding/components/OnboardingContainer", () => ({
  OnboardingContainer: () => <p data-screen="onboarding">onboarding</p>,
}));

vi.mock("@/ui/features/authentication/components/LockScreen", () => ({
  LockScreen: () => <p data-screen="lock">lock</p>,
}));

vi.mock("@/ui/features/home/components/HomeView", () => ({
  HomeView: ({ onNavigate }: { onNavigate: (tab: TabKey) => void }) => {
    state.homeNavigate = onNavigate;
    return <p data-screen="home">home</p>;
  },
}));

vi.mock("@/ui/features/profile/components/ProfileView", () => ({
  ProfileView: () => <p data-screen="profile">profile</p>,
}));

vi.mock("@/ui/features/activity/components/ActivityView", () => ({
  ActivityView: () => <p data-screen="activity">activity</p>,
}));

vi.mock("@/ui/features/settings/components/BasicSettings", () => ({
  BasicSettings: () => <p data-screen="settings">settings</p>,
}));

vi.mock("@/ui/components/dialogs/AddKeyDialog", () => ({
  AddKeyDialog: (props: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
  }) => {
    state.addKeyDialog = props;
    return props.isOpen ? <p data-screen="add-key">add key</p> : null;
  },
}));

const { MainApp } = await import("@/ui/components/layout/MainApp");

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

const MAIN = {
  id: "key-main",
  label: "Main",
  publicKeyHex: "a".repeat(64),
  publicKeyBech32: `npub1${"a".repeat(58)}`,
  isUnreadable: false,
  createdAt: 0,
} as UIKeyInfo;

let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => {
    root.render(<MainApp />);
  });
}

function screen(): string | null {
  return document.querySelector("[data-screen]")?.getAttribute("data-screen") ?? null;
}

function tab(label: string): HTMLButtonElement {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Primary"] button')
  ).find((button) => button.textContent === label);
  if (!found) throw new Error(`Tab not found: ${label}`);
  return found;
}

function click(element: HTMLElement) {
  act(() => {
    element.click();
  });
}

beforeEach(() => {
  listeners.clear();
  state.needsOnboarding = false;
  state.isLocked = false;
  state.isLoading = false;
  state.lock.mockReset();
  state.refreshKeys.mockReset();
  state.keys = [MAIN];
  state.selectedUnlockedKey = MAIN;
  state.homeNavigate = null;
  state.addKeyDialog = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("MainApp gates", () => {
  it("sends a first-time user to onboarding before anything else", () => {
    state.needsOnboarding = true;
    state.isLocked = true;
    mount();
    expect(screen()).toBe("onboarding");
    expect(container.querySelector("nav")).toBeNull();
  });

  it("shows the lock screen and no tabs while the vault is locked", () => {
    state.isLocked = true;
    mount();
    expect(screen()).toBe("lock");
    expect(container.querySelector("header")).toBeNull();
  });

  it("shows a loading line while keys are being read", () => {
    state.isLoading = true;
    mount();
    expect(container.textContent).toContain("Opening Ostrilo...");
    expect(screen()).toBeNull();
  });
});

describe("MainApp navigation", () => {
  it("opens on Home with Home marked as the current page", () => {
    mount();
    expect(screen()).toBe("home");
    expect(tab("Home").getAttribute("aria-current")).toBe("page");
    expect(tab("Profile").hasAttribute("aria-current")).toBe(false);
  });

  it.each([
    ["Profile", "profile"],
    ["Activity", "activity"],
    ["Settings", "settings"],
    ["Home", "home"],
  ])("switches to %s from the tab bar", (label, expected) => {
    mount();
    click(tab("Settings"));
    click(tab(label));
    expect(screen()).toBe(expected);
    expect(tab(label).getAttribute("aria-current")).toBe("page");
  });

  it("lets Home navigate to another tab", () => {
    mount();
    act(() => state.homeNavigate?.("activity"));
    expect(screen()).toBe("activity");
  });

  it("jumps to Activity when the background asks it to", () => {
    mount();
    act(() => {
      for (const listener of listeners) listener({ __event: "ostrilo.switchToActivity" });
    });
    expect(screen()).toBe("activity");
  });

  it("ignores unrelated broadcasts", () => {
    mount();
    act(() => {
      for (const listener of listeners) listener({ __event: "ostrilo.queue.updated" });
      for (const listener of listeners) listener("noise");
    });
    expect(screen()).toBe("home");
  });
});

describe("MainApp header", () => {
  it("locks the vault from the header", () => {
    mount();
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Lock extension"]')!);
    expect(state.lock).toHaveBeenCalledTimes(1);
  });

  it("opens the add-key dialog from the key selector and closes it again", () => {
    mount();
    expect(state.addKeyDialog?.isOpen).toBe(false);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select active key"]'
    )!;
    trigger.focus();
    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    click(document.querySelector<HTMLElement>('[aria-label="Add new key"]')!);

    expect(state.addKeyDialog?.isOpen).toBe(true);
    expect(document.querySelector('[data-screen="add-key"]')).not.toBeNull();

    act(() => state.addKeyDialog?.onSuccess());
    expect(state.refreshKeys).toHaveBeenCalledTimes(1);

    act(() => state.addKeyDialog?.onClose());
    expect(state.addKeyDialog?.isOpen).toBe(false);
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActivityLogEntry, OriginPolicy } from "@/domain/types";
import type { ProfileMetadata } from "@/domain/profile/types";
import type { UIKeyInfo } from "@/ui/state/KeyManagerContext";

const client = vi.hoisted(() => ({
  rpc: vi.fn<(request: { type: string; params?: { pubkey?: string } }) => Promise<unknown>>(),
  activityGetRecent: vi.fn<
    (options?: { limit?: number; offset?: number }) => Promise<{ entries: unknown[]; total: number }>
  >(),
  activityFilterBy: vi.fn(),
}));

const tabs = vi.hoisted(() => ({ create: vi.fn() }));

const env = vi.hoisted(() => ({
  settingsLoading: false,
  relays: [] as unknown[],
  origins: [] as unknown[],
  keysLoading: false,
  keys: [] as unknown[],
  selectedUnlockedKey: null as unknown,
  refreshKeys: vi.fn(async () => undefined),
}));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("wxt/browser", () => ({
  browser: {
    tabs,
    runtime: { getURL: (path: string) => `chrome-extension://ostrilo${path}` },
  },
}));

vi.mock("@/ui/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: { relays: env.relays, origins: env.origins },
    isLoading: env.settingsLoading,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({
    keys: env.keys,
    selectedUnlockedKey: env.selectedUnlockedKey,
    isLoading: env.keysLoading,
    refreshKeys: env.refreshKeys,
  }),
}));

const { HomeView } = await import("@/ui/features/home/components/HomeView");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NPUB = `npub1${"a".repeat(52)}xyz123`;
const HEX = "a".repeat(64);

const ACTIVE: UIKeyInfo = {
  id: "key-main",
  label: "Main",
  publicKeyHex: HEX,
  publicKeyBech32: NPUB,
  isUnreadable: false,
  createdAt: 0,
} as UIKeyInfo;

function entry(overrides: Partial<ActivityLogEntry>): ActivityLogEntry {
  return {
    id: overrides.id ?? "entry",
    timestamp: Math.floor(Date.now() / 1000),
    origin: "https://primal.net",
    kind: 1,
    decision: "allow",
    ...overrides,
  } as ActivityLogEntry;
}

let container: HTMLDivElement;
let root: Root;

async function mount(onNavigate?: (tab: string) => void) {
  await act(async () => {
    root.render(<HomeView onNavigate={onNavigate} />);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function row(label: string): HTMLButtonElement {
  const found = Array.from(
    container.querySelectorAll<HTMLButtonElement>('section[aria-label="Signer status"] button')
  ).find((button) => button.textContent?.includes(label));
  if (!found) throw new Error(`Row not found: ${label}`);
  return found;
}

function profileAnswers(profile: ProfileMetadata | null) {
  client.rpc.mockImplementation(async (request) =>
    request.type === "profile.get" ? profile : null
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  client.rpc.mockReset();
  profileAnswers(null);
  client.activityGetRecent.mockReset().mockResolvedValue({ entries: [], total: 0 });
  client.activityFilterBy.mockReset();
  tabs.create.mockReset();
  env.settingsLoading = false;
  env.relays = [];
  env.origins = [];
  env.keysLoading = false;
  env.keys = [ACTIVE];
  env.selectedUnlockedKey = ACTIVE;
  env.refreshKeys.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("HomeView while settings or keys load", () => {
  it("shows a busy skeleton and no counts until settings arrive", async () => {
    env.settingsLoading = true;
    await mount();
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.textContent).toBe("Loading home");
    expect(container.querySelector('section[aria-label="Signer status"]')).toBeNull();
  });

  it("shows the skeleton while keys are still being read", async () => {
    env.keysLoading = true;
    await mount();
    expect(container.textContent).toContain("Loading home");
  });
});

describe("HomeView identity card", () => {
  it("shows the active key's npub, truncated, with copy and QR actions", async () => {
    await mount();
    const card = container.querySelector('section[aria-label="Active identity"]');
    expect(card?.textContent).toContain("Public key");
    expect(card?.textContent).toContain(`${NPUB.slice(0, 8)}…${NPUB.slice(-6)}`);
    expect(card?.querySelector('button[aria-label="Copy public key"]')).not.toBeNull();
  });

  it("says the stored key could not be read rather than showing a key", async () => {
    env.selectedUnlockedKey = { ...ACTIVE, publicKeyBech32: "", isUnreadable: true };
    await mount();
    const card = container.querySelector('section[aria-label="Active identity"]');
    expect(card?.textContent).toContain("could not be read");
    expect(card?.textContent).not.toContain("npub1");
  });

  it("names the key whose public key cannot be read, and never offers to create one", async () => {
    env.selectedUnlockedKey = { ...ACTIVE, publicKeyBech32: "", isUnreadable: true };
    await mount();
    const card = container.querySelector('section[aria-label="Active identity"]');
    expect(card?.textContent).toContain("key-main");
    expect(card?.textContent).toContain("Choose another key");
    expect(card?.textContent).toContain("has not deleted or changed it");
    expect(card?.textContent).not.toContain("Unnamed");
    expect(card?.textContent).not.toContain("Create or import");
  });

  it("offers a retry that reads the keys again when the public key cannot be read", async () => {
    env.selectedUnlockedKey = { ...ACTIVE, publicKeyBech32: "", isUnreadable: true };
    await mount();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again"
    );

    await act(async () => retry?.click());

    expect(env.refreshKeys).toHaveBeenCalledTimes(1);
  });

  it("says no key is selected, not that none exists, when keys exist without a selection", async () => {
    env.selectedUnlockedKey = undefined;
    await mount();
    const card = container.querySelector('section[aria-label="Active identity"]');
    expect(card?.textContent).toContain("No key is selected");
    expect(card?.textContent).not.toContain("Create or import");
  });

  it("invites creating a key when the vault has none", async () => {
    env.selectedUnlockedKey = null;
    env.keys = [];
    await mount();
    expect(container.textContent).toContain("Create or import a key");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("HomeView signer status rows", () => {
  it("states counts for keys, relays and granted sites", async () => {
    env.keys = [ACTIVE, { ...ACTIVE, id: "second" }];
    env.relays = [{ url: "wss://a" }, { url: "wss://b" }, { url: "wss://c" }];
    env.origins = [{ origin: "https://a" }, { origin: "https://b" }] as OriginPolicy[];
    await mount();
    expect(row("Keys").textContent).toContain("2");
    expect(row("Relays").textContent).toContain("3");
    expect(row("Site permissions").textContent).toContain("2 trusted");
  });

  it("uses words rather than zeros for an empty vault", async () => {
    env.keys = [];
    env.selectedUnlockedKey = null;
    await mount();
    expect(row("Keys").textContent).toContain("None yet");
    expect(row("Relays").textContent).toContain("None");
    expect(row("Site permissions").textContent).toContain("None granted");
  });

  it.each([
    ["Keys", "#keys"],
    ["Relays", "#relays"],
    ["Site permissions", "#permissions"],
  ])("opens the options page on the right tab from %s", async (label, hash) => {
    await mount();
    act(() => row(label).click());
    expect(tabs.create).toHaveBeenCalledWith({
      url: `chrome-extension://ostrilo/options.html${hash}`,
    });
  });

  it("omits the display name row when the host cannot navigate", async () => {
    await mount();
    expect(() => row("Display name")).toThrow();
  });
});

describe("HomeView display name placeholder", () => {
  it("holds a placeholder, then shows the published name", async () => {
    let answer: (profile: ProfileMetadata) => void = () => {};
    client.rpc.mockImplementation(
      () => new Promise((resolve) => (answer = resolve as typeof answer))
    );
    await mount(vi.fn());

    const pending = row("Display name");
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.textContent).not.toContain("Not set");
    expect(client.rpc).toHaveBeenCalledWith(
      expect.objectContaining({ type: "profile.get", params: expect.objectContaining({ pubkey: HEX }) })
    );

    await act(async () => {
      answer({ display_name: "Alice", name: "alice" });
    });
    await flush();

    expect(row("Display name").hasAttribute("aria-busy")).toBe(false);
    expect(row("Display name").textContent).toContain("Alice");
  });

  it("falls back to name when no display name is published", async () => {
    profileAnswers({ name: "bob" });
    await mount(vi.fn());
    await flush();
    expect(row("Display name").textContent).toContain("bob");
  });

  it("stops waiting and says Not set when the lookup is slow", async () => {
    let answer: (profile: ProfileMetadata) => void = () => {};
    client.rpc.mockImplementation(
      () => new Promise((resolve) => (answer = resolve as typeof answer))
    );
    await mount(vi.fn());
    expect(row("Display name").getAttribute("aria-busy")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(row("Display name").hasAttribute("aria-busy")).toBe(false);
    expect(row("Display name").textContent).toContain("Not set");

    await act(async () => {
      answer({ name: "late" });
    });
    await flush();
    expect(row("Display name").textContent).toContain("late");
  });

  it("says Not set once a key with no profile has been looked up", async () => {
    profileAnswers(null);
    await mount(vi.fn());
    await flush();
    expect(row("Display name").textContent).toContain("Not set");
  });

  it("navigates to the profile tab from the display name row", async () => {
    const onNavigate = vi.fn();
    await mount(onNavigate);
    act(() => row("Display name").click());
    expect(onNavigate).toHaveBeenCalledWith("profile");
  });
});

describe("HomeView recent activity", () => {
  it("shows the first-run card when nothing has been decided", async () => {
    await mount(vi.fn());
    await flush();
    expect(container.textContent).toContain("No activity yet");
    expect(container.textContent).not.toContain("Recent activity");
  });

  it("shows a hidden skeleton rather than the first-run card while loading", async () => {
    client.activityGetRecent.mockReturnValue(new Promise(() => {}));
    await mount(vi.fn());
    expect(container.textContent).not.toContain("No activity yet");
    expect(container.querySelector('section[aria-hidden="true"]')).not.toBeNull();
  });

  it("phrases each decision as an action with its full origin", async () => {
    const now = Math.floor(Date.now() / 1000);
    client.activityGetRecent.mockResolvedValue({
      entries: [
        entry({ id: "1", kind: 1, decision: "allow", origin: "https://primal.net", timestamp: now - 10 }),
        entry({ id: "2", kind: 7, decision: "deny", origin: "http://evil.example:8080", timestamp: now - 120 }),
        entry({ id: "3", operation: "identity_disclosure", kind: undefined, decision: "allow", timestamp: now - 7_200 }),
        entry({ id: "4", operation: "identity_disclosure", kind: undefined, decision: "deny", timestamp: now - 172_800 }),
        entry({ id: "5", timestamp: now - 2_000_000 }),
      ],
      total: 5,
    });
    await mount(vi.fn());
    await flush();

    const section = container.querySelector('section[aria-labelledby="home-recent-activity"]')!;
    const rows = Array.from(section.querySelectorAll(".ink-row"));
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain("Signed short text note");
    expect(rows[0].textContent).toContain("https://primal.net");
    expect(rows[0].textContent).toContain("now");
    expect(rows[1].textContent).toContain("Denied reaction");
    expect(rows[1].textContent).toContain("http://evil.example:8080");
    expect(rows[1].textContent).toContain("2m ago");
    expect(rows[2].textContent).toContain("Shared your public key");
    expect(rows[2].textContent).toContain("2h ago");
    expect(rows[3].textContent).toContain("Refused to share your public key");
    expect(rows[3].textContent).toContain("2d ago");
  });

  it("keeps rows past the popup's two for the wider side panel only", async () => {
    client.activityGetRecent.mockResolvedValue({
      entries: ["a", "b", "c"].map((id) => entry({ id })),
      total: 3,
    });
    await mount(vi.fn());
    await flush();
    const rows = Array.from(
      container.querySelectorAll('section[aria-labelledby="home-recent-activity"] .ink-row')
    );
    expect(rows.map((item) => item.className.includes("hidden"))).toEqual([false, false, true]);
  });

  it("counts weeks for old entries", async () => {
    client.activityGetRecent.mockResolvedValue({
      entries: [entry({ id: "old", timestamp: Math.floor(Date.now() / 1000) - 1_300_000 })],
      total: 1,
    });
    await mount(vi.fn());
    await flush();
    expect(container.querySelector("time")?.textContent).toBe("2w ago");
  });

  it("opens the full log from See all", async () => {
    client.activityGetRecent.mockResolvedValue({ entries: [entry({ id: "x" })], total: 1 });
    const onNavigate = vi.fn();
    await mount(onNavigate);
    await flush();
    const seeAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "See all"
    );
    act(() => seeAll!.click());
    expect(onNavigate).toHaveBeenCalledWith("activity");
  });

  it("offers no See all without a navigation host", async () => {
    client.activityGetRecent.mockResolvedValue({ entries: [entry({ id: "x" })], total: 1 });
    await mount();
    await flush();
    expect(container.textContent).toContain("Recent activity");
    expect(container.textContent).not.toContain("See all");
  });
});

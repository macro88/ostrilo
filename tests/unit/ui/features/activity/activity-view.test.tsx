/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActivityLogEntry, PendingRequest } from "@/domain/types";

type Page = { entries: ActivityLogEntry[]; total: number };

const listeners = vi.hoisted(() => new Set<(message: unknown) => void>());

const client = vi.hoisted(() => ({
  activityGetRecent: vi.fn<(options: { limit: number; offset: number }) => Promise<Page>>(),
  activityFilterBy: vi.fn<
    (filters: { origin?: string; kind?: number; limit: number; offset: number }) => Promise<Page>
  >(),
  activityGetOrigins: vi.fn<() => Promise<string[]>>(),
  getAllApprovalRequests: vi.fn<() => Promise<{ requests: PendingRequest[] }>>(),
  getApprovalCount: vi.fn<() => Promise<{ count: number }>>(),
}));

const runtime = vi.hoisted(() => ({
  sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
}));

const settings = vi.hoisted(() => ({ sidePanel: false }));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: runtime.sendMessage,
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
      },
    },
  },
}));

vi.mock("@/ui/hooks/useAppSettings", () => ({
  useAppSettings: () => ({ settings: { sidePanel: settings.sidePanel }, isLoading: false }),
}));

vi.mock("@/ui/features/approval/components/ApprovalPrompt", () => ({
  ApprovalPrompt: ({ embedded, onDismiss }: { embedded?: boolean; onDismiss?: () => void }) => (
    <div data-testid="embedded-prompt" data-embedded={String(Boolean(embedded))}>
      <button type="button" onClick={onDismiss}>
        finish queue
      </button>
    </div>
  ),
}));

const { ActivityView } = await import("@/ui/features/activity/components/ActivityView");

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
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

const NOW = Math.floor(new Date("2026-09-25T12:00:00Z").getTime() / 1000);

function entry(overrides: Partial<ActivityLogEntry>): ActivityLogEntry {
  return {
    id: "entry",
    timestamp: NOW - 30,
    origin: "https://primal.net",
    kind: 1,
    decision: "allow",
    ...overrides,
  } as ActivityLogEntry;
}

function pending(id: string, kind?: number, origin = "https://primal.net"): PendingRequest {
  return (
    kind === undefined
      ? { id, origin, operation: "identity_disclosure", createdAt: NOW, timeoutAt: NOW + 60 }
      : {
          id,
          origin,
          operation: "sign_event",
          event: { kind, content: "", tags: [], created_at: NOW },
          eventIdHash: "0".repeat(64),
          createdAt: NOW,
          timeoutAt: NOW + 60,
        }
  ) as PendingRequest;
}

const SAMPLE: ActivityLogEntry[] = [
  entry({ id: "1", origin: "https://primal.net", kind: 1, decision: "allow", contentPreview: "gm nostr" }),
  entry({ id: "2", origin: "http://snort.social", kind: 7, decision: "deny", timestamp: NOW - 4_000 }),
  entry({ id: "3", origin: "https://primal.net", operation: "identity_disclosure", kind: undefined, decision: "allow", timestamp: NOW - 90_000 }),
];

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<ActivityView />);
  });
  await flush();
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonByText(text: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text
  );
}

function logRows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".ink-card .ink-row.items-start"));
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

async function choose(triggerLabel: string, optionText: string) {
  const trigger = container.querySelector<HTMLElement>(`[aria-label="${triggerLabel}"]`);
  if (!trigger) throw new Error(`No select: ${triggerLabel}`);
  trigger.focus();
  keyDown(trigger, "Enter");
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === optionText
  );
  if (!option) throw new Error(`No option: ${optionText}`);
  option.focus();
  keyDown(option, "Enter");
  await flush();
}

function broadcast(event: string) {
  act(() => {
    for (const listener of listeners) listener({ __event: event });
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  listeners.clear();
  settings.sidePanel = false;
  client.activityGetRecent.mockReset().mockResolvedValue({ entries: SAMPLE, total: SAMPLE.length });
  client.activityFilterBy.mockReset().mockResolvedValue({ entries: [], total: 0 });
  client.activityGetOrigins
    .mockReset()
    .mockResolvedValue(["http://snort.social", "https://older.example", "https://primal.net"]);
  client.getAllApprovalRequests.mockReset().mockResolvedValue({ requests: [] });
  client.getApprovalCount.mockReset().mockResolvedValue({ count: 0 });
  runtime.sendMessage.mockReset().mockResolvedValue({ ok: true });
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("ActivityView log states", () => {
  it("shows a busy skeleton while the first page is out", async () => {
    client.activityGetRecent.mockReturnValue(new Promise(() => {}));
    await mount();
    const busy = container.querySelector('[aria-label="Loading activity"]');
    expect(busy?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).not.toContain("No activity yet");
    expect(container.querySelector('[aria-label="Filter by site"]')).toBeNull();
  });

  it("says there is no activity and hides the filters for an empty log", async () => {
    client.activityGetRecent.mockResolvedValue({ entries: [], total: 0 });
    await mount();
    expect(container.textContent).toContain("No activity yet");
    expect(container.textContent).toContain("Sign events to see your activity history here");
    expect(container.querySelector('[aria-label="Filter by site"]')).toBeNull();
    expect(buttonByText("Show all activity")).toBeUndefined();
  });

  it("renders each decision with its kind, full origin, outcome and age", async () => {
    await mount();
    const rows = logRows();
    expect(rows).toHaveLength(3);

    expect(rows[0].querySelector("h3")?.textContent).toBe("Short Text Note");
    expect(rows[0].textContent).toContain("https://primal.net");
    expect(rows[0].querySelector(".sr-only")?.textContent).toBe("Approved");
    expect(rows[0].textContent).toContain("gm nostr");
    expect(rows[0].querySelector("time")?.textContent).toBe("now");
    expect(rows[0].querySelector("time")?.getAttribute("dateTime")).toBe(
      new Date((NOW - 30) * 1000).toISOString()
    );

    expect(rows[1].querySelector("h3")?.textContent).toBe("Reaction");
    expect(rows[1].textContent).toContain("http://snort.social");
    expect(rows[1].querySelector(".seal-chip-danger")?.textContent).toBe("Denied");
    expect(rows[1].querySelector("time")?.textContent).toBe("1h ago");

    expect(rows[2].querySelector("h3")?.textContent).toBe("Identity disclosure");
    expect(rows[2].querySelector("time")?.textContent).toBe("1d ago");
  });

  it("loads the next page on demand and appends it", async () => {
    const first = Array.from({ length: 10 }, (_, index) => entry({ id: `a${index}` }));
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: first, total: 11 })
      .mockResolvedValueOnce({ entries: [entry({ id: "b0", kind: 3 })], total: 11 });
    await mount();

    act(() => buttonByText("Load more")!.click());
    await flush();

    expect(client.activityGetRecent).toHaveBeenLastCalledWith({ limit: 10, offset: 10 });
    expect(logRows()).toHaveLength(11);
    expect(logRows()[10].querySelector("h3")?.textContent).toBe("Contacts");
    expect(buttonByText("Load more")).toBeUndefined();
  });

  it("shows a loading line instead of Load more while the next page is out", async () => {
    const first = Array.from({ length: 10 }, (_, index) => entry({ id: `a${index}` }));
    client.activityGetRecent
      .mockResolvedValueOnce({ entries: first, total: 20 })
      .mockReturnValueOnce(new Promise(() => {}));
    await mount();
    act(() => buttonByText("Load more")!.click());
    await flush();
    expect(container.textContent).toContain("Loading more");
    expect(buttonByText("Load more")).toBeUndefined();
    expect(logRows()).toHaveLength(10);
  });
});

describe("ActivityView denial reasons and previews", () => {
  async function mountWith(entries: ActivityLogEntry[]) {
    client.activityGetRecent.mockResolvedValue({ entries, total: entries.length });
    await mount();
    return logRows();
  }

  it.each([
    ["user", "You denied it"],
    ["remembered", "Blocked by a remembered rule"],
    ["rate_limited", "Too many requests from this site"],
    ["vault_locked", "Ostrilo was locked"],
    ["timeout", "No answer in time, or the window was closed"],
    ["key_unreadable", "The signing key could not be read"],
  ] as const)("says why a %s denial happened", async (reason, copy) => {
    const [row] = await mountWith([entry({ id: "d", decision: "deny", reason })]);
    expect(row.textContent).toContain(copy);
  });

  it("shows no reason for an old denial, an unrecognised one, or an allowed entry", async () => {
    const rows = await mountWith([
      entry({ id: "old", decision: "deny" }),
      entry({ id: "odd", decision: "deny", reason: "future_reason" as never }),
      entry({ id: "ok", decision: "allow", reason: "remembered" }),
    ]);
    for (const row of rows) {
      expect(row.textContent).not.toContain("Blocked by a remembered rule");
      expect(row.textContent).not.toContain("future_reason");
      expect(row.querySelectorAll("p")).toHaveLength(1);
    }
  });

  it("shows direction and hidden characters in a preview as escapes", async () => {
    const [row] = await mountWith([
      entry({ id: "p", contentPreview: "send\u202Egpj.exe\u200B now" }),
    ]);
    const text = row.textContent ?? "";
    expect(text).toContain("send\\u{202E}gpj.exe\\u{200B} now");
    expect(text).not.toContain("\u202E");
    expect(text).not.toContain("\u200B");
  });
});

describe("ActivityView filters", () => {
  it("offers every origin in the stored log, including ones not on the loaded page", async () => {
    await mount();
    const trigger = container.querySelector<HTMLElement>('[aria-label="Filter by site"]')!;
    trigger.focus();
    keyDown(trigger, "Enter");
    const labels = Array.from(document.querySelectorAll('[role="option"]')).map((item) =>
      item.textContent?.trim()
    );
    expect(labels).toEqual([
      "All Origins",
      "http://snort.social",
      "https://older.example",
      "https://primal.net",
    ]);
  });

  it("filters by an origin that only the background list knows about", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [], total: 0 });
    await mount();
    await choose("Filter by site", "https://older.example");

    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: "https://older.example",
      kind: undefined,
      limit: 10,
      offset: 0,
    });
  });

  it("keeps the log usable when the origin list cannot be read", async () => {
    client.activityGetOrigins.mockRejectedValue(new Error("storage unavailable"));
    await mount();
    expect(logRows()).toHaveLength(SAMPLE.length);
  });

  it("offers the protected kinds, so deletions and auth events can be filtered", async () => {
    await mount();
    const trigger = container.querySelector<HTMLElement>('[aria-label="Filter by event kind"]')!;
    trigger.focus();
    keyDown(trigger, "Enter");
    const labels = Array.from(document.querySelectorAll('[role="option"]')).map((item) =>
      item.textContent?.trim()
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "Event Deletion Request (5)",
        "Client Authentication (22242)",
        "HTTP Auth (27235)",
        "Short Text Note (1)",
        "Zap Request (9734)",
      ])
    );
    expect(labels?.filter((l) => l?.endsWith("(1)"))).toHaveLength(1);
  });

  it.each([
    ["Event Deletion Request (5)", 5],
    ["Client Authentication (22242)", 22242],
    ["HTTP Auth (27235)", 27235],
  ])("queries by %s", async (label, kind) => {
    client.activityFilterBy.mockResolvedValue({ entries: [], total: 0 });
    await mount();
    await choose("Filter by event kind", label);
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: undefined,
      kind,
      limit: 10,
      offset: 0,
    });
  });

  it("queries by origin and shows only what comes back", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [SAMPLE[1]], total: 1 });
    await mount();
    await choose("Filter by site", "http://snort.social");

    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: "http://snort.social",
      kind: undefined,
      limit: 10,
      offset: 0,
    });
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0].textContent).toContain("http://snort.social");
    expect(buttonByText("Clear filters")).toBeDefined();
  });

  it("queries by kind", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [SAMPLE[1]], total: 1 });
    await mount();
    await choose("Filter by event kind", "Reaction (7)");
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: undefined,
      kind: 7,
      limit: 10,
      offset: 0,
    });
  });

  it("treats kind 0 as a real filter, keeping the filters and the way back on screen", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [], total: 0 });
    await mount();
    await choose("Filter by event kind", "Profile Metadata (0)");

    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: undefined,
      kind: 0,
      limit: 10,
      offset: 0,
    });
    expect(container.textContent).toContain("No matching activity");
    expect(container.querySelector('[aria-label="Filter by event kind"]')).not.toBeNull();
    expect(buttonByText("Show all activity")).toBeDefined();
  });

  it("reports a failed read instead of claiming the log is empty, and retries", async () => {
    client.activityGetRecent
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce({ entries: SAMPLE, total: SAMPLE.length });
    await mount();

    expect(container.textContent).toContain("Could not load activity");
    expect(container.textContent).not.toContain("No activity yet");

    act(() => buttonByText("Try again")!.click());
    await flush();

    expect(container.textContent).not.toContain("Could not load activity");
    expect(logRows()).toHaveLength(SAMPLE.length);
  });

  it("says nothing matches and offers a way back when a filter is empty", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [], total: 0 });
    await mount();
    await choose("Filter by event kind", "Reaction (7)");

    expect(container.textContent).toContain("No matching activity");
    expect(container.textContent).toContain("Nothing in the log matches these filters.");
    expect(container.querySelector('[aria-label="Filter by event kind"]')).not.toBeNull();

    act(() => buttonByText("Show all activity")!.click());
    await flush();
    expect(client.activityGetRecent).toHaveBeenCalledTimes(2);
    expect(logRows()).toHaveLength(3);
  });

  it("clears both filters and returns to the unfiltered log", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [SAMPLE[0]], total: 1 });
    await mount();
    await choose("Filter by site", "https://primal.net");
    await choose("Filter by event kind", "Short Text Note (1)");
    expect(client.activityFilterBy).toHaveBeenLastCalledWith({
      origin: "https://primal.net",
      kind: 1,
      limit: 10,
      offset: 0,
    });

    act(() => buttonByText("Clear filters")!.click());
    await flush();
    expect(logRows()).toHaveLength(3);
    expect(buttonByText("Clear filters")).toBeUndefined();
  });

  it("returns to the unfiltered log when All is chosen", async () => {
    client.activityFilterBy.mockResolvedValue({ entries: [SAMPLE[0]], total: 1 });
    await mount();
    await choose("Filter by site", "https://primal.net");
    await choose("Filter by site", "All Origins");
    await choose("Filter by event kind", "Short Text Note (1)");
    await choose("Filter by event kind", "All Kinds");
    expect(client.activityGetRecent).toHaveBeenCalledTimes(3);
    expect(logRows()).toHaveLength(3);
  });
});

describe("ActivityView pending approvals", () => {
  function withPending(requests: PendingRequest[], count = requests.length) {
    client.getAllApprovalRequests.mockResolvedValue({ requests });
    client.getApprovalCount.mockResolvedValue({ count });
  }

  it("shows no pending card when the queue is empty", async () => {
    await mount();
    expect(container.textContent).not.toContain("Pending Approvals");
  });

  it("lists up to three queued requests with kind and origin", async () => {
    withPending(
      [
        pending("r1", 1),
        pending("r2", undefined, "https://coracle.social"),
        pending("r3", 7),
        pending("r4", 3),
        pending("r5", 3),
      ],
      5
    );
    await mount();

    const toggle = buttonByText("Pending Approvals5")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const card = toggle.parentElement!;
    const text = card.textContent ?? "";
    expect(text).toContain("Short Text Note");
    expect(text).toContain("kind:1");
    expect(text).toContain("Identity disclosure");
    expect(text).toContain("https://coracle.social");
    expect(text).toContain("pubkey");
    expect(text).toContain("Reaction");
    expect(text).not.toContain("Contacts");
    expect(text).toContain("+2 more pending");
  });

  it("collapses and expands the pending card", async () => {
    withPending([pending("r1", 1)]);
    await mount();
    const toggle = buttonByText("Pending Approvals1")!;

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(buttonByText("Open Approval Window")).toBeUndefined();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).not.toContain("more pending");
  });

  it("asks the background to open the approval window in popup mode", async () => {
    withPending([pending("r1", 1)]);
    await mount();
    await act(async () => buttonByText("Open Approval Window")!.click());
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      __command: "ostrilo.openApprovalWindow",
    });
    expect(document.querySelector('[data-testid="embedded-prompt"]')).toBeNull();
  });

  it.each([
    [{ ok: false, error: { message: "window blocked" } }, "window blocked"],
    [{ ok: false, error: "plain failure" }, "plain failure"],
    [undefined, "Failed to open approval window"],
  ])("reports a refused open-window request (%j)", async (response, message) => {
    runtime.sendMessage.mockResolvedValue(response);
    withPending([pending("r1", 1)]);
    await mount();
    await act(async () => buttonByText("Open Approval Window")!.click());
    await flush();
    const reported = consoleError.mock.calls.at(-1)?.[1];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe(message);
  });

  it("reviews approvals in an embedded overlay in side-panel mode", async () => {
    settings.sidePanel = true;
    withPending([pending("r1", 1)]);
    await mount();

    act(() => buttonByText("Review Approvals")!.click());
    const prompt = document.querySelector('[data-testid="embedded-prompt"]');
    expect(prompt?.getAttribute("data-embedded")).toBe("true");
    expect(runtime.sendMessage).not.toHaveBeenCalled();

    act(() => buttonByText("finish queue")!.click());
    expect(document.querySelector('[data-testid="embedded-prompt"]')).toBeNull();
  });

  it("closes the overlay from its back control", async () => {
    settings.sidePanel = true;
    withPending([pending("r1", 1)]);
    await mount();
    act(() => buttonByText("Review Approvals")!.click());
    act(() => buttonByText("Back to Activity")!.click());
    expect(document.querySelector('[data-testid="embedded-prompt"]')).toBeNull();
  });

  it("refreshes the queue when the background says it changed", async () => {
    await mount();
    expect(container.textContent).not.toContain("Pending Approvals");

    withPending([pending("r1", 1), pending("r2", 1)]);
    broadcast("ostrilo.queue.updated");
    await flush();
    expect(buttonByText("Pending Approvals2")).toBeDefined();
    expect(document.querySelector('[data-testid="embedded-prompt"]')).toBeNull();
  });

  it("opens the overlay by itself when a request lands in side-panel mode", async () => {
    settings.sidePanel = true;
    await mount();
    withPending([pending("r1", 1)]);
    broadcast("ostrilo.queue.updated");
    await flush();
    expect(document.querySelector('[data-testid="embedded-prompt"]')).not.toBeNull();
  });

  it("ignores unrelated broadcasts", async () => {
    await mount();
    const before = client.getAllApprovalRequests.mock.calls.length;
    broadcast("ostrilo.settings.changed");
    act(() => {
      for (const listener of listeners) listener(null);
    });
    expect(client.getAllApprovalRequests.mock.calls.length).toBe(before);
  });

  it("keeps the log usable when the queue cannot be read", async () => {
    client.getAllApprovalRequests.mockRejectedValue(new Error("no background"));
    await mount();
    expect(logRows()).toHaveLength(3);
    expect(container.textContent).not.toContain("Pending Approvals");
  });
});

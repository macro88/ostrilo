/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { ApprovalAction, KeyRecord, OriginPolicy, PendingRequest } from "@/domain/types";

const listeners = vi.hoisted(() => new Set<(message: unknown) => void>());

const client = vi.hoisted(() => ({
  getAllApprovalRequests: vi.fn<() => Promise<{ requests: PendingRequest[] }>>(),
  resolveApprovalRequest: vi.fn<(id: string, action: ApprovalAction) => Promise<void>>(),
  getApprovalCount: vi.fn<() => Promise<{ count: number }>>(),
  listKeys: vi.fn<() => Promise<KeyRecord[]>>(),
  reportActivity: vi.fn(),
}));

const settings = vi.hoisted(() => ({
  origins: [] as OriginPolicy[],
  isLoading: false,
}));

vi.mock("@/infrastructure/messaging/client", () => client);

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
      },
    },
  },
}));

vi.mock("@/ui/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: { origins: settings.origins },
    isLoading: settings.isLoading,
  }),
}));

const { ApprovalPrompt } = await import("@/ui/features/approval/components/ApprovalPrompt");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = 1_790_000_000;
const BOUND = "ab".repeat(32);
const SELECTED = "cd".repeat(32);

function signing(id: string, overrides: Partial<PendingRequest> = {}, kind = 1, content = `content of ${id}`): PendingRequest {
  return {
    id,
    origin: "https://primal.net",
    operation: "sign_event",
    event: { kind, content, tags: [["t", "ostrilo"]], created_at: NOW },
    eventIdHash: "e".repeat(64),
    signingPubkey: BOUND,
    createdAt: NOW,
    timeoutAt: NOW + 60,
    ...overrides,
  } as PendingRequest;
}

function disclosure(id: string): PendingRequest {
  return {
    id,
    origin: "https://coracle.social",
    operation: "identity_disclosure",
    signingPubkey: BOUND,
    createdAt: NOW,
    timeoutAt: NOW + 60,
  } as PendingRequest;
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

async function render(ui: ReactNode = <ApprovalPrompt />) {
  act(() => {
    root.render(ui);
  });
  await settle();
  await settle();
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
    item.textContent?.includes(label)
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

function exactButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

async function press(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function detail(): HTMLElement | null {
  return container.querySelector('[data-testid="approval-detail"]');
}

function queueItems(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="approval-request-item"]'));
}

function queue(...pages: PendingRequest[][]) {
  client.getAllApprovalRequests.mockReset();
  for (const page of pages) {
    client.getAllApprovalRequests.mockResolvedValueOnce({ requests: page });
  }
  client.getAllApprovalRequests.mockResolvedValue({ requests: pages.at(-1) ?? [] });
}

let close: ReturnType<typeof vi.spyOn>;
let consoleLog: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  listeners.clear();
  settings.origins = [];
  settings.isLoading = false;
  client.getAllApprovalRequests.mockReset().mockResolvedValue({ requests: [] });
  client.resolveApprovalRequest.mockReset().mockResolvedValue(undefined);
  client.getApprovalCount.mockReset().mockResolvedValue({ count: 0 });
  client.listKeys.mockReset().mockResolvedValue([]);
  client.reportActivity.mockReset();
  close = vi.spyOn(window, "close").mockImplementation(() => {});
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  close.mockRestore();
  consoleLog.mockRestore();
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("ApprovalPrompt window states", () => {
  it("says it is loading until the queue has been read", () => {
    client.getAllApprovalRequests.mockReturnValue(new Promise(() => {}));
    act(() => {
      root.render(<ApprovalPrompt />);
    });
    expect(container.querySelector("h2")?.textContent).toBe("Loading requests");
    expect(container.querySelector("button")).toBeNull();
  });

  it("reports a failed read instead of claiming the queue is empty", async () => {
    client.getAllApprovalRequests.mockRejectedValueOnce(new Error("background asleep"));
    await render();
    expect(container.textContent).toContain("Error loading requests");
    expect(container.textContent).toContain("background asleep");
    expect(container.textContent).not.toContain("No Pending Requests");

    client.getAllApprovalRequests.mockResolvedValue({ requests: [signing("r1")] });
    await press(findButton("Try again"));
    expect(detail()).not.toBeNull();
  });

  it("uses a generic message for a non-Error failure", async () => {
    client.getAllApprovalRequests.mockRejectedValueOnce("nope");
    await render();
    expect(container.textContent).toContain("Could not load the requests.");
  });

  it("offers Close on an empty queue and closes its own window", async () => {
    await render();
    expect(container.textContent).toContain("No Pending Requests");
    await press(findButton("Close"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("asks an embedding host to dismiss it rather than closing the document", async () => {
    const onDismiss = vi.fn();
    await render(<ApprovalPrompt embedded onDismiss={onDismiss} />);
    await press(findButton("Close"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("ApprovalPrompt shows what will be signed", () => {
  it("opens a lone request straight into its detail", async () => {
    queue([signing("r1", { origin: "http://primal.net" }, 1, "gm from a lone request")]);
    await render();
    const pane = detail()!;
    expect(pane.querySelector("h1")?.textContent).toBe("Short Text Note request");
    expect(pane.textContent).toContain("http://primal.net");
    expect(pane.textContent).toContain("Not a secure connection");
    expect(pane.textContent).toContain("gm from a lone request");
    expect(pane.textContent).toContain("ostrilo");
    expect(pane.textContent).toContain("abababab");
  });

  it("shows the key bound to the request even when another key is selected", async () => {
    client.listKeys.mockResolvedValue([
      { id: "k", label: "Selected elsewhere", pubkey: SELECTED, isSelected: true } as KeyRecord,
    ]);
    queue([signing("r1")]);
    await render();
    expect(detail()!.textContent).toContain("abababab");
    expect(detail()!.textContent).not.toContain("Selected elsewhere");
  });

  it("falls back to the selected key only when the request carries none", async () => {
    client.listKeys.mockResolvedValue([
      { id: "k", label: "Main", pubkey: SELECTED, isSelected: true } as KeyRecord,
    ]);
    queue([signing("r1", { signingPubkey: undefined })]);
    await render();
    expect(detail()!.textContent).toContain("Main");
  });

  it("counts the request down from its own deadline", async () => {
    queue([signing("r1", { timeoutAt: NOW + 30 })]);
    await render();
    const seconds = () =>
      Number(container.querySelector('[role="timer"]')?.textContent?.split(":")[1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const first = seconds();
    expect(first).toBeGreaterThan(24);
    expect(first).toBeLessThan(30);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(first - seconds()).toBe(3);
  });

  it("shows the trust chip for the origin once settings have loaded", async () => {
    settings.origins = [{ origin: "https://primal.net", trustLevel: "high", rules: {} } as OriginPolicy];
    queue([signing("r1")]);
    await render();
    expect(container.querySelector('section[aria-label="Requesting site"]')?.textContent).toContain(
      "Trusted"
    );
  });

  it.each([
    ["medium", "Medium trust"],
    ["low", "Known site"],
    ["unrecognised", "Known site"],
  ])("labels a %s-trust origin as %s", async (trustLevel, label) => {
    settings.origins = [{ origin: "https://primal.net", trustLevel, rules: {} } as unknown as OriginPolicy];
    queue([signing("r1")]);
    await render();
    expect(container.querySelector('section[aria-label="Requesting site"]')?.textContent).toContain(label);
  });

  it("marks an origin with no policy as a first visit", async () => {
    settings.origins = [{ origin: "https://elsewhere.example", trustLevel: "high", rules: {} } as OriginPolicy];
    queue([signing("r1")]);
    await render();
    expect(container.querySelector('section[aria-label="Requesting site"]')?.textContent).toContain(
      "First visit"
    );
  });

  it("shows no trust chip while settings are still loading", async () => {
    settings.isLoading = true;
    queue([signing("r1")]);
    await render();
    const site = container.querySelector('section[aria-label="Requesting site"]')!.textContent ?? "";
    expect(site).not.toMatch(/First visit|Known site|Trusted|Medium trust/);
  });

  it("routes an identity request to the disclosure view", async () => {
    queue([disclosure("d1")]);
    await render();
    expect(container.querySelector('[data-testid="disclosure-detail"] h1')?.textContent).toBe(
      "Identity request"
    );
    await press(findButton("Share public key"));
    expect(client.resolveApprovalRequest).toHaveBeenCalledWith("d1", "allow_once");
  });

  it("keeps Deny available for a request it cannot render", async () => {
    const broken = { ...signing("bad"), event: undefined } as unknown as PendingRequest;
    queue([broken]);
    await render();
    expect(container.querySelector('[data-testid="approval-render-error"]')).not.toBeNull();
    await press(findButton("Deny this request"));
    expect(client.resolveApprovalRequest).toHaveBeenCalledWith("bad", "deny");
  });
});

describe("ApprovalPrompt decisions", () => {
  it("sends allow_once for a plain approval and reports activity", async () => {
    queue([signing("r1")], []);
    await render();
    await press(findButton("Approve & sign"));
    expect(client.resolveApprovalRequest).toHaveBeenCalledWith("r1", "allow_once");
    expect(client.reportActivity).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("sends a standing allow when remember is ticked on an unprotected kind", async () => {
    queue([signing("r1", {}, 7, "+")], []);
    await render();
    await press(container.querySelector("input[type='checkbox']")!);
    await press(findButton("Approve & sign"));
    expect(client.resolveApprovalRequest).toHaveBeenCalledWith("r1", "allow");
  });

  it("sends deny, and deny_remember when remember is ticked", async () => {
    queue([signing("r1"), signing("r2")], [signing("r2")], [signing("r2")]);
    client.getApprovalCount.mockResolvedValue({ count: 1 });
    await render();

    await press(queueItems()[0]);
    await press(exactButton("Deny"));
    expect(client.resolveApprovalRequest).toHaveBeenLastCalledWith("r1", "deny");

    await press(queueItems()[0]);
    await press(container.querySelector("input[type='checkbox']")!);
    await press(exactButton("Deny"));
    expect(client.resolveApprovalRequest).toHaveBeenLastCalledWith("r2", "deny_remember");
  });

  it("never re-binds the pane to the next request after a resolution", async () => {
    queue([signing("r1"), signing("r2")], [signing("r2")]);
    client.getApprovalCount.mockResolvedValue({ count: 1 });
    await render();
    expect(detail()).toBeNull();
    expect(container.textContent).toContain("Select a request to review the exact payload.");

    await press(queueItems().find((item) => item.dataset.requestId === "r1")!);
    expect(detail()?.textContent).toContain("content of r1");
    await press(findButton("Approve & sign"));

    expect(client.resolveApprovalRequest).toHaveBeenCalledWith("r1", "allow_once");
    expect(
      detail(),
      "SECURITY REGRESSION: the approve button re-bound to a request the user never opened"
    ).toBeNull();
    expect(queueItems().map((item) => item.dataset.requestId)).toEqual(["r2"]);
    expect(close).not.toHaveBeenCalled();
  });

  it("returns to the list from the back control", async () => {
    queue([signing("r1")]);
    await render();
    const list = container.querySelector('[data-testid="approval-inbox"]')!;
    expect(list.className).toContain("hidden");
    await press(container.querySelector('button[aria-label="Back to approval queue"]')!);
    expect(list.className).not.toContain("hidden");
  });

  it("shows the refusal when resolving fails and re-enables the controls", async () => {
    queue([signing("r1")]);
    client.resolveApprovalRequest.mockRejectedValue(new Error("request expired"));
    await render();
    await press(findButton("Approve & sign"));
    expect(container.textContent).toContain("Error loading requests");
    expect(container.textContent).toContain("request expired");
    expect(close).not.toHaveBeenCalled();
  });

  it("uses a generic message when a resolve fails without an Error", async () => {
    queue([signing("r1")]);
    client.resolveApprovalRequest.mockRejectedValue("nope");
    await render();
    await press(exactButton("Deny"));
    expect(container.textContent).toContain("Could not complete that action. Try again.");
  });
});

describe("ApprovalPrompt batch deny", () => {
  it("denies every request from Deny all and closes once the queue is empty", async () => {
    queue([signing("r1"), signing("r2", { origin: "https://snort.social" })], []);
    await render();
    await press(findButton("Deny all"));
    const calls = client.resolveApprovalRequest.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([["r1", "deny"], ["r2", "deny"]]));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("denies one site's requests and stays open for the rest", async () => {
    queue(
      [signing("a1"), signing("a2"), signing("b1", { origin: "https://snort.social" })],
      [signing("b1", { origin: "https://snort.social" })]
    );
    client.getApprovalCount.mockResolvedValue({ count: 1 });
    await render();
    await press(findButton("Deny all from site"));
    expect(client.resolveApprovalRequest.mock.calls).toEqual([
      ["a1", "deny"],
      ["a2", "deny"],
    ]);
    expect(queueItems().map((item) => item.dataset.requestId)).toEqual(["b1"]);
    expect(close).not.toHaveBeenCalled();
  });

  it("shows the refusal when a batch fails", async () => {
    queue([signing("r1"), signing("r2")]);
    client.resolveApprovalRequest.mockRejectedValue(new Error("vault locked"));
    await render();
    await press(findButton("Deny all"));
    expect(container.textContent).toContain("vault locked");
  });

  it("uses a generic message when a batch fails without an Error", async () => {
    queue([signing("r1"), signing("r2")]);
    client.resolveApprovalRequest.mockRejectedValue(0);
    await render();
    await press(findButton("Deny all"));
    expect(container.textContent).toContain("Could not complete that action for every request. Try again.");
  });
});

describe("ApprovalPrompt live queue", () => {
  it("re-reads the queue when the background says it changed", async () => {
    queue([signing("r1"), signing("r2")], [signing("r1"), signing("r2"), signing("r3")]);
    await render();
    expect(queueItems()).toHaveLength(2);

    act(() => {
      for (const listener of listeners) listener({ __event: "ostrilo.queue.updated" });
    });
    await settle();
    expect(queueItems()).toHaveLength(3);
  });

  it("keeps the open request open across a refresh that still contains it", async () => {
    queue([signing("r1"), signing("r2")], [signing("r1"), signing("r2")], [signing("r1"), signing("r2"), signing("r3")]);
    await render();
    await press(queueItems()[0]);
    const openId = detail()?.textContent?.includes("content of r1") ? "r1" : "r2";

    act(() => {
      for (const listener of listeners) listener({ __event: "ostrilo.queue.updated" });
    });
    await settle();
    expect(detail()?.textContent).toContain(`content of ${openId}`);
  });

  it("ignores broadcasts that are not queue updates", async () => {
    queue([signing("r1")]);
    await render();
    const reads = client.getAllApprovalRequests.mock.calls.length;
    act(() => {
      for (const listener of listeners) {
        listener({ __event: "ostrilo.settings.changed" });
        listener("noise");
        listener(null);
      }
    });
    await settle();
    expect(client.getAllApprovalRequests.mock.calls.length).toBe(reads);
  });
});

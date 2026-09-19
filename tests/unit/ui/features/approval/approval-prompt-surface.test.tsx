/**
 * @vitest-environment jsdom
 */
/**
 * Which surface `ApprovalPrompt` is allowed to close.
 *
 * The component is mounted in two places that behave nothing alike when the
 * queue empties. In popup mode it owns `approval.html`, a window whose only
 * purpose was to ask this question, and closing it is the correct ending. In
 * side-panel mode `ActivityPendingApprovals` mounts the same component
 * `embedded` inside the panel document, so `window.close()` there closes the
 * side panel itself - the user signs one event and the panel they docked
 * disappears out from under them.
 *
 * `embedded` already existed when this was written but only reached
 * QueueListView's header, so both surfaces took the same exit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { PendingRequest } from "@/domain/types";

const listeners = new Set<(message: unknown) => void>();

const getAllApprovalRequests = vi.fn();
const resolveApprovalRequest = vi.fn();
const getApprovalCount = vi.fn();
const listKeys = vi.fn();
const reportActivity = vi.fn();

vi.mock("@/infrastructure/messaging/client", () => ({
  getAllApprovalRequests: (...args: unknown[]) =>
    getAllApprovalRequests(...args),
  resolveApprovalRequest: (...args: unknown[]) =>
    resolveApprovalRequest(...args),
  getApprovalCount: (...args: unknown[]) => getApprovalCount(...args),
  listKeys: (...args: unknown[]) => listKeys(...args),
  reportActivity: (...args: unknown[]) => reportActivity(...args),
}));

// `webextension-polyfill` refuses to load outside an extension page, and the
// only thing the component asks of it is the queue-update broadcast.
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: (fn: (message: unknown) => void) => listeners.add(fn),
        removeListener: (fn: (message: unknown) => void) =>
          listeners.delete(fn),
      },
    },
  },
}));

vi.mock("@/ui/hooks/useAppSettings", () => ({
  useAppSettings: () => ({ settings: { origins: [] }, isLoading: false }),
}));

const { ApprovalPrompt } = await import(
  "@/ui/features/approval/components/ApprovalPrompt"
);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  mountedRoots.push({ root, container });
  return container;
}

function signingRequest(): PendingRequest {
  return {
    id: "request-1",
    origin: "https://primal.net",
    operation: "sign_event",
    event: {
      kind: 1,
      content: "hello from a docked panel",
      tags: [],
      created_at: 1_735_689_600,
    },
    eventIdHash:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    createdAt: 1_735_689_600,
    timeoutAt: 1_735_689_660,
  } as PendingRequest;
}

function findButton(container: Element, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.includes(label)
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

/** Drains the promises `handleAction` awaits between click and close. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

/**
 * Renders, waits for the lone request to auto-open its detail, clears the
 * 500 ms approve cooldown, and approves.
 */
async function approveTheOnlyRequest(ui: ReactNode) {
  const container = render(ui);
  // Twice: the first drains the initial fetch, which is what mounts the detail
  // pane and only then starts its 500 ms cooldown timer. One advance leaves
  // the approve button disabled and the click asserts nothing.
  await settle();
  await settle();
  // The approve button is disabled for 500 ms after the detail binds, so a
  // click before this point lands on a disabled control and asserts nothing.
  click(findButton(container, "Approve & sign"));
  await settle();
  return container;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners.clear();
  getAllApprovalRequests.mockReset();
  resolveApprovalRequest.mockReset().mockResolvedValue(undefined);
  getApprovalCount.mockReset().mockResolvedValue({ count: 0 });
  listKeys.mockReset().mockResolvedValue([]);
  reportActivity.mockReset();

  // One request, then an empty queue once it has been resolved: the exact
  // sequence that reaches the close path.
  getAllApprovalRequests
    .mockResolvedValueOnce({ requests: [signingRequest()] })
    .mockResolvedValue({ requests: [] });
});

afterEach(() => {
  // `vi.spyOn` hands back the existing mock when a method is already spied, so
  // without this the close counts accumulate across the cases below.
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ApprovalPrompt close behaviour by surface", () => {
  it("does not close the document when the last embedded request is signed", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});

    await approveTheOnlyRequest(<ApprovalPrompt embedded />);

    expect(resolveApprovalRequest).toHaveBeenCalledWith(
      "request-1",
      "allow_once"
    );
    expect(close).not.toHaveBeenCalled();
  });

  it("asks its host to dismiss the embedded surface instead", async () => {
    vi.spyOn(window, "close").mockImplementation(() => {});
    const onDismiss = vi.fn();

    await approveTheOnlyRequest(
      <ApprovalPrompt embedded onDismiss={onDismiss} />
    );

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("still closes its own window when not embedded", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});

    await approveTheOnlyRequest(<ApprovalPrompt />);

    expect(close).toHaveBeenCalledTimes(1);
  });
});

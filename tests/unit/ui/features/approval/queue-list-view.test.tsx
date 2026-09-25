/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { QueueListView } from "@/ui/features/approval/components/QueueListView";
import type { OriginTrust } from "@/ui/features/approval/components/useApprovalDisplay";
import type { PendingRequest } from "@/domain/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = 1_735_689_600;

function signing(id: string, origin: string, kind: number, content: string, createdAt = NOW): PendingRequest {
  return {
    id,
    origin,
    operation: "sign_event",
    event: { kind, content, tags: [], created_at: createdAt },
    eventIdHash: "0".repeat(64),
    createdAt,
    timeoutAt: createdAt + 75,
  } as PendingRequest;
}

function disclosure(id: string, origin: string, createdAt = NOW): PendingRequest {
  return {
    id,
    origin,
    operation: "identity_disclosure",
    createdAt,
    timeoutAt: createdAt + 30,
  } as PendingRequest;
}

let container: HTMLDivElement;
let root: Root;

function render(ui: ReactNode) {
  act(() => {
    root.render(ui);
  });
}

function groups(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="approval-origin-group"]'));
}

function items(scope: ParentNode = container): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('[data-testid="approval-request-item"]'));
}

function buttonByText(text: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const QUEUE = [
  signing("a1", "https://primal.net", 1, "first note", NOW - 30),
  signing("b1", "http://snort.social", 7, "+", NOW - 5),
  signing("a2", "https://primal.net", 3, "", NOW - 20),
  disclosure("c1", "https://coracle.social:8443", NOW - 60),
];

describe("QueueListView grouping", () => {
  it("groups by full origin, newest group first, with scheme and port shown", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    expect(groups().map((group) => group.getAttribute("data-origin"))).toEqual([
      "http://snort.social",
      "https://primal.net",
      "https://coracle.social:8443",
    ]);
    expect(groups()[2].querySelector("button")?.textContent).toContain("https://coracle.social:8443");
    expect(container.textContent).toContain("4 requests from 3 sites");
    expect(container.querySelector("h1")?.textContent).toBe("Approval Inbox");
  });

  it("uses the singular for one request from one site", () => {
    render(<QueueListView requests={[QUEUE[0]]} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    expect(container.textContent).toContain("1 request from 1 site");
  });

  it("drops its own heading when embedded under another title", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} embedded />);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("4 requests from 3 sites");
  });

  it("says so when the queue is empty", () => {
    render(<QueueListView requests={[]} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    expect(container.textContent).toBe("No Pending Requests");
  });

  it("shows a trust chip per origin once trust is known", () => {
    const trust = new Map<string, OriginTrust>([
      ["https://primal.net", "trusted"],
      ["http://snort.social", "first_visit"],
      ["https://coracle.social:8443", "medium"],
    ]);
    render(
      <QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} trustByOrigin={trust} />
    );
    const headers = groups().map((group) => group.querySelector("button")?.textContent ?? "");
    expect(headers[0]).toContain("First visit");
    expect(headers[1]).toContain("Trusted");
    expect(headers[2]).toContain("Medium trust");
  });
});

describe("QueueListView rows", () => {
  it("shows kind, name, countdown and a preview for signing requests", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    const [row] = items(groups()[1]);
    expect(row.textContent).toContain("kind:1");
    expect(row.textContent).toContain("Short Text Note");
    expect(row.textContent).toContain("0:45");
    expect(row.textContent).toContain("first note");
  });

  it("labels an identity disclosure without inventing a kind", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    const [row] = items(groups()[2]);
    expect(row.textContent).toContain("identity");
    expect(row.textContent).toContain("Identity disclosure");
    expect(row.textContent).toContain("Wants to read your public key.");
    expect(row.textContent).not.toContain("kind:");
    expect(row.textContent).toContain("0:00");
  });

  it("omits the preview line for empty content", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    const rows = items(groups()[1]);
    expect(rows[1].querySelectorAll("p")).toHaveLength(0);
  });

  it("escapes direction controls before truncating the preview", () => {
    const hostile = signing("h", "https://x.example", 1, `pay‮${"9".repeat(80)}`);
    render(<QueueListView requests={[hostile]} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    const preview = items()[0].querySelector("p")?.textContent ?? "";
    expect(preview).not.toContain("‮");
    expect(preview.startsWith("pay\\u{202E}")).toBe(true);
    expect(preview.endsWith("...")).toBe(true);
    expect(preview.length).toBe(53);
  });

  it("marks the selected request and reports which row was chosen", () => {
    const onSelect = vi.fn();
    render(
      <QueueListView requests={QUEUE} selectedRequestId="a2" nowSeconds={NOW} onSelectRequest={onSelect} />
    );
    const current = items().filter((row) => row.getAttribute("aria-current") === "true");
    expect(current.map((row) => row.getAttribute("data-request-id"))).toEqual(["a2"]);

    act(() => items(groups()[0])[0].click());
    expect(onSelect).toHaveBeenCalledWith("b1");
  });

  it("folds a group away and shows its count instead", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    const header = groups()[1].querySelector("button")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");

    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(items(groups()[1])).toHaveLength(0);
    expect(groups()[1].querySelector('[aria-label="2 requests"]')?.textContent).toBe("2");

    act(() => header.click());
    expect(items(groups()[1])).toHaveLength(2);
  });

  it("uses the singular in a folded group's count", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    act(() => groups()[0].querySelector("button")!.click());
    expect(groups()[0].querySelector('[aria-label="1 request"]')).not.toBeNull();
  });
});

describe("QueueListView batch actions", () => {
  it("offers no bulk approve anywhere", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} onBatchAction={vi.fn()} />);
    const labels = Array.from(container.querySelectorAll("button")).map((button) => button.textContent ?? "");
    expect(labels.some((label) => /approve/i.test(label))).toBe(false);
  });

  it("denies every queued request from Deny all", () => {
    const onBatch = vi.fn();
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} onBatchAction={onBatch} />);
    expect(container.textContent).toContain("Keys never leave your browser.");
    act(() => buttonByText("Deny all")!.click());
    expect(onBatch).toHaveBeenCalledWith("deny", ["a1", "b1", "a2", "c1"]);
  });

  it("denies only one site's requests from that site's group", () => {
    const onBatch = vi.fn();
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} onBatchAction={onBatch} />);
    const perSite = groups().map((group) => buttonByText("Deny all from site", group));
    expect(perSite.map(Boolean)).toEqual([false, true, false]);

    act(() => perSite[1]!.click());
    expect(onBatch).toHaveBeenCalledWith("deny", ["a1", "a2"]);
  });

  it("drops the per-site deny when only one site is queued", () => {
    render(
      <QueueListView
        requests={[QUEUE[0], QUEUE[2]]}
        nowSeconds={NOW}
        onSelectRequest={vi.fn()}
        onBatchAction={vi.fn()}
      />
    );
    expect(buttonByText("Deny all from site")).toBeUndefined();
    expect(buttonByText("Deny all")).toBeDefined();
  });

  it("disables bulk deny while a resolution is in flight", () => {
    render(
      <QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} onBatchAction={vi.fn()} disabled />
    );
    expect(buttonByText("Deny all")?.disabled).toBe(true);
    expect(buttonByText("Deny all from site")?.disabled).toBe(true);
  });

  it("has no footer when the host takes no batch actions", () => {
    render(<QueueListView requests={QUEUE} nowSeconds={NOW} onSelectRequest={vi.fn()} />);
    expect(buttonByText("Deny all")).toBeUndefined();
    expect(container.textContent).not.toContain("Keys never leave your browser.");
  });
});

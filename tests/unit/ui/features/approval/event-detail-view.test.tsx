/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { EventDetailView } from "@/ui/features/approval/components/EventDetailView";
import type { ApprovalAction, PendingRequest } from "@/domain/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function makeRequest(kind: number): PendingRequest {
  return {
    id: `request-${kind}`,
    origin: "https://primal.net",
    event: {
      kind,
      content: "test content",
      tags: [],
      created_at: 1_735_689_600,
    },
    eventIdHash:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    createdAt: 1_735_689_600,
    timeoutAt: 1_735_689_660,
  };
}

function renderEventDetail(kind: number, onResolve = vi.fn()) {
  const container = render(
    <EventDetailView
      request={makeRequest(kind)}
      signingKey={null}
      countdown={30}
      onResolve={onResolve as (action: ApprovalAction) => void}
      onBack={vi.fn()}
    />
  );

  return { container, onResolve };
}

function findButton(container: Element, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label)
  );

  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("EventDetailView remembered policy copy", () => {
  it("maps remembered unprotected approval to a durable allow action", () => {
    const { container, onResolve } = renderEventDetail(10002);
    const checkbox = container.querySelector("input[type='checkbox']")!;

    expect(container.textContent).toContain(
      "Remember this decision for this site and event kind"
    );
    expect(container.textContent).toContain("Kind 10002");
    expect(container.textContent).toContain("Relay List");
    expect(container.textContent).toContain(
      "Future relay list requests from primal.net will use this choice"
    );

    click(checkbox);
    click(findButton(container, "Approve & sign"));

    expect(onResolve).toHaveBeenCalledWith("allow");
  });

  it("keeps protected approval one-time and explains the guard", () => {
    const { container, onResolve } = renderEventDetail(1);
    const checkbox = container.querySelector("input[type='checkbox']")!;

    expect(container.textContent).toContain(
      "Remember a denial for this site and event kind"
    );
    expect(container.textContent).toContain(
      "This kind always requires approval before signing"
    );

    click(checkbox);
    click(findButton(container, "Approve & sign"));

    expect(onResolve).toHaveBeenCalledWith("allow_once");
  });

  it("still supports remembered denial for protected kinds", () => {
    const { container, onResolve } = renderEventDetail(9734);
    const checkbox = container.querySelector("input[type='checkbox']")!;

    click(checkbox);
    click(findButton(container, "Deny"));

    expect(onResolve).toHaveBeenCalledWith("deny_remember");
  });
});

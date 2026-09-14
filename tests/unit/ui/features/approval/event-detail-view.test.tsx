/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { EventDetailView } from "@/ui/features/approval/components/EventDetailView";
import type { ApprovalAction, SigningRequest } from "@/domain/types";

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

/**
 * Advances past the approve cooldown.
 *
 * The approve action is disabled for 500 ms whenever the detail pane binds
 * to a request it was not previously showing, so a click already in motion
 * lands on a disabled button rather than on an approval for an event that
 * appeared underneath it. Tests that mean to approve must say so.
 */
function settleApprove() {
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function makeRequest(kind: number): SigningRequest {
  return {
    id: `request-${kind}`,
    origin: "https://primal.net",
    operation: "sign_event",
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
      // The origin now carries its scheme: dropping it made a hijacked
      // http:// origin render identically to the real https:// one.
      "Future relay list requests from https://primal.net will use this choice"
    );

    click(checkbox);
    settleApprove();
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
    settleApprove();
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

describe("what the dialog shows is what gets signed", () => {
  function renderWith(
    overrides: Partial<SigningRequest["event"]>,
    origin?: string
  ) {
    const base = makeRequest(1);
    const request: SigningRequest = {
      ...base,
      origin: origin ?? base.origin,
      event: { ...base.event, ...overrides },
      signingPubkey: "ab".repeat(32),
    };
    const container = render(
      <EventDetailView
        request={request}
        signingKey={null}
        countdown={30}
        onResolve={vi.fn()}
        onBack={vi.fn()}
      />
    );
    return { container, request };
  }

  it("shows the full origin including scheme", () => {
    // The old formatter returned only the hostname, so a hijacked
    // http://primal.net rendered identically to the real https://primal.net.
    const { container } = renderWith({}, "https://primal.net");
    expect(container.textContent).toContain("https://primal.net");
  });

  it("flags a plaintext origin", () => {
    const { container } = renderWith({}, "http://primal.net");
    expect(container.textContent).toContain("http://primal.net");
    expect(
      container.textContent,
      "SECURITY REGRESSION: an unauthenticated origin was shown with no warning"
    ).toContain("Not a secure connection");
  });

  it("does not flag an HTTPS origin", () => {
    const { container } = renderWith({}, "https://primal.net");
    expect(container.textContent).not.toContain("Not a secure connection");
  });

  it("escapes a direction-control character and says how many", () => {
    const { container } = renderWith({ content: "pay 1\u202E000,01 sats" });
    expect(
      container.textContent,
      "SECURITY REGRESSION: a bidi override reached the rendered content"
    ).not.toContain("\u202E");
    expect(container.textContent).toContain("\\u{202E}");
    expect(container.textContent).toContain("hidden or direction-control");
  });

  it("says nothing about hidden characters when there are none", () => {
    const { container } = renderWith({ content: "an ordinary note" });
    expect(container.textContent).not.toContain("hidden or direction-control");
  });

  it("labels the content with its UTF-8 byte length, not its string length", () => {
    // "日本語" is 3 characters and 9 bytes. A length label understates
    // adversarial content by up to 4x.
    const { container } = renderWith({ content: "日本語" });
    expect(container.textContent).toContain("9");
    expect(container.textContent).toContain("bytes");
  });

  it("marks the end of the content, so nothing hides below a fold", () => {
    const { container } = renderWith({ content: "x".repeat(5_000) });
    expect(container.textContent).toContain("end of content");
  });

  it("renders the signing key bound to the REQUEST, not the selected key", () => {
    // This used to read whichever key the approval UI had selected when it
    // loaded, so switching the active key while a prompt was open changed the
    // displayed identity without changing the one that would sign.
    const base = makeRequest(1);
    const container = render(
      <EventDetailView
        request={{ ...base, signingPubkey: "ab".repeat(32) }}
        signingKey={{ id: "other", label: "Other key", pubkey: "cd".repeat(32) } as never}
        countdown={30}
        onResolve={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(container.textContent).toContain("abababab");
    expect(
      container.textContent,
      "SECURITY REGRESSION: the dialog showed a key other than the one that will sign"
    ).not.toContain("cdcdcdcd");
  });

  it("disables approve on bind and enables it after the cooldown", () => {
    // A click already in motion must land on a disabled button rather than on
    // an approval for an event that appeared underneath it.
    const { container } = renderWith({});
    const approve = findButton(container, "Approve");
    expect(
      (approve as HTMLButtonElement).disabled,
      "SECURITY REGRESSION: approve was live the instant the pane bound"
    ).toBe(true);

    // Deny is never delayed: refusing is always safe.
    expect((findButton(container, "Deny") as HTMLButtonElement).disabled).toBe(
      false
    );

    settleApprove();
    expect((findButton(container, "Approve") as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});

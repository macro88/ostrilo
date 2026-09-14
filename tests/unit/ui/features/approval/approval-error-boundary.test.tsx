/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApprovalErrorBoundary } from "@/ui/features/approval/components/ApprovalErrorBoundary";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * There was no error boundary anywhere in the approval tree. A request that
 * threw while rendering blanked the whole window, which removed the Deny
 * control for EVERY OTHER queued request too — so one malformed entry could
 * leave the user unable to refuse the rest.
 *
 * The property under test is not "an error is caught". It is that the deny path
 * survives: the request a user cannot read is the one most deserving of
 * refusal.
 */

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return { container, root };
}

function Exploding(): never {
  throw new Error("cannot render this request");
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("approval error boundary", () => {
  it("renders its children when nothing throws", () => {
    const { container } = render(
      <ApprovalErrorBoundary onDeny={() => {}}>
        <p>Request detail</p>
      </ApprovalErrorBoundary>
    );

    expect(container.textContent).toContain("Request detail");
  });

  it("keeps the deny path reachable when a request cannot be rendered", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onDeny = vi.fn();

    const { container } = render(
      <ApprovalErrorBoundary onDeny={onDeny}>
        <Exploding />
      </ApprovalErrorBoundary>
    );

    const denyButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Deny")
    );
    expect(
      denyButton,
      "SECURITY REGRESSION: a request that failed to render left no way to refuse it"
    ).toBeDefined();

    act(() => {
      denyButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("offers a route back to the other queued requests", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onBack = vi.fn();

    const { container } = render(
      <ApprovalErrorBoundary onDeny={() => {}} onBack={onBack}>
        <Exploding />
      </ApprovalErrorBoundary>
    );

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Back to the queue")
    );
    act(() => {
      backButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("tells the user not to approve what they cannot read", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <ApprovalErrorBoundary onDeny={() => {}}>
        <Exploding />
      </ApprovalErrorBoundary>
    );

    expect(container.textContent).toMatch(/could not be displayed/i);
    expect(container.textContent).toMatch(/do not approve/i);
  });

  it("clears the failure when a different request is selected", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });

    act(() => {
      root.render(
        <ApprovalErrorBoundary resetKey="bad" onDeny={() => {}}>
          <Exploding />
        </ApprovalErrorBoundary>
      );
    });
    expect(container.textContent).toMatch(/could not be displayed/i);

    // One bad entry must not make every later selection look broken.
    act(() => {
      root.render(
        <ApprovalErrorBoundary resetKey="good" onDeny={() => {}}>
          <p>Request detail</p>
        </ApprovalErrorBoundary>
      );
    });

    expect(container.textContent).toContain("Request detail");
  });

  it("logs the message and stack, not the thrown object", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <ApprovalErrorBoundary onDeny={() => {}}>
        <Exploding />
      </ApprovalErrorBoundary>
    );

    // This console belongs to a window whose whole job is to show the user
    // something trustworthy; a thrown object here can carry request content.
    const ours = consoleError.mock.calls.filter(
      (call) => call[0] === "[Approval] Failed to render request:"
    );
    expect(ours).toHaveLength(1);
    expect(ours[0][1]).toBe("cannot render this request");
  });
});

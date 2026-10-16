/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DisclosureDetailView } from "@/ui/features/approval/components/DisclosureDetailView";
import type { ApprovalAction, DisclosureRequest, KeyRecord } from "@/domain/types";
import type { OriginTrust } from "@/ui/features/approval/components/useApprovalDisplay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BOUND = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function request(overrides: Partial<DisclosureRequest> = {}): DisclosureRequest {
  return {
    id: "disclose-1",
    origin: "https://primal.net",
    operation: "identity_disclosure",
    createdAt: 1_735_689_600,
    timeoutAt: 1_735_689_660,
    signingPubkey: BOUND,
    ...overrides,
  } as DisclosureRequest;
}

function key(pubkey: string, label: string): KeyRecord {
  return { id: `id-${label}`, label, pubkey } as KeyRecord;
}

let container: HTMLDivElement;
let root: Root;

function mount(
  props: {
    request?: DisclosureRequest;
    signingKey?: KeyRecord | null;
    isResolving?: boolean;
    showBackButton?: boolean;
    originTrust?: OriginTrust;
  } = {}
) {
  const onResolve = vi.fn<(action: ApprovalAction) => void>();
  const onBack = vi.fn();
  act(() => {
    root.render(
      <DisclosureDetailView
        request={props.request ?? request()}
        signingKey={props.signingKey ?? null}
        countdown={42}
        onResolve={onResolve}
        onBack={onBack}
        showBackButton={props.showBackButton ?? false}
        isResolving={props.isResolving ?? false}
        originTrust={props.originTrust}
      />
    );
  });
  return { onResolve, onBack };
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text
  );
  if (!found) throw new Error(`No button ${text}`);
  return found;
}

function remember() {
  act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}

function cooldown() {
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("DisclosureDetailView shows what would be shared", () => {
  it("titles the prompt and shows the full origin with its countdown", () => {
    mount();
    expect(container.querySelector("h1")?.textContent).toBe("Identity request");
    expect(container.querySelector('[role="timer"]')?.textContent).toBe("0:42");
    expect(container.querySelector('section[aria-label="Requesting site"] h2')?.textContent).toBe(
      "https://primal.net"
    );
    expect(container.textContent).toContain("https://primal.net can tie your visit to this identity");
  });

  it("names the key bound to the request, not the selected key", () => {
    mount({ signingKey: key(OTHER, "Other") });
    const facts = container.querySelector('section[aria-label="Request facts"]')!;
    expect(facts.textContent).toContain("Identity");
    expect(facts.textContent).toContain("abababab");
    expect(facts.textContent).not.toContain("Other");
    expect(facts.textContent).not.toContain("cdcdcdcd");
  });

  it("shows the key's name when the selected key is the bound key", () => {
    mount({ signingKey: key(BOUND, "Main") });
    const facts = container.querySelector('section[aria-label="Request facts"]')!;
    expect(facts.textContent).toContain("Main");
    expect(facts.textContent).toContain("ababababab…abababab");
  });

  it("falls back to the selected key when the request carries none", () => {
    mount({ request: request({ signingPubkey: undefined }), signingKey: key(OTHER, "Other") });
    expect(container.textContent).toContain("Other");
  });

  it("says Selected key rather than inventing one when nothing is known", () => {
    mount({ request: request({ signingPubkey: undefined }) });
    const facts = container.querySelector('section[aria-label="Request facts"]')!;
    expect(facts.textContent).toContain("Selected key");
    expect(facts.querySelector("button")).toBeNull();
  });

  it("warns about a plaintext origin", () => {
    mount({ request: request({ origin: "http://primal.net" }) });
    expect(container.textContent).toContain("http://primal.net");
    expect(container.textContent).toContain("Not a secure connection");
  });

  it("uses a globe rather than an initial for an IP origin", () => {
    mount({ request: request({ origin: "https://192.168.1.4" }) });
    const seal = container.querySelector('section[aria-label="Requesting site"] [aria-hidden="true"]');
    expect(seal?.querySelector("svg")).not.toBeNull();
  });

  it("shows the origin's trust chip", () => {
    mount({ originTrust: "known" });
    expect(container.textContent).toContain("Known site");
  });
});

describe("DisclosureDetailView decisions", () => {
  it("shares once by default", () => {
    const { onResolve } = mount();
    cooldown();
    act(() => buttonByText("Share public key").click());
    expect(onResolve).toHaveBeenCalledWith("allow_once");
  });

  it("records a standing allow when remember is ticked", () => {
    const { onResolve } = mount();
    remember();
    expect(container.textContent).toContain("https://primal.net will not ask again for this identity.");
    cooldown();
    act(() => buttonByText("Share public key").click());
    expect(onResolve).toHaveBeenCalledWith("allow");
  });

  it("denies once, or remembers the denial when ticked", () => {
    const first = mount();
    act(() => buttonByText("Deny").click());
    expect(first.onResolve).toHaveBeenCalledWith("deny");

    remember();
    act(() => buttonByText("Deny").click());
    expect(first.onResolve).toHaveBeenLastCalledWith("deny_remember");
  });

  it("keeps share disabled during the cooldown and while resolving", () => {
    mount();
    expect(buttonByText("Share public key").disabled).toBe(true);
    expect(buttonByText("Deny").disabled).toBe(false);
    cooldown();
    expect(buttonByText("Share public key").disabled).toBe(false);

    mount({ isResolving: true });
    expect(buttonByText("Share public key").disabled).toBe(true);
    expect(buttonByText("Deny").disabled).toBe(true);
  });

  it("returns to the queue from the back control when compact", () => {
    const { onBack } = mount({ showBackButton: true });
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Back to approval queue"]')!.click()
    );
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("copies the full identity key", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mount();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Copy Identity"]')!.click();
    });
    expect(writeText).toHaveBeenCalledWith(BOUND);
  });
});

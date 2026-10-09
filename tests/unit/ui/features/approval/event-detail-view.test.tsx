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

  it("says one byte, not 1 bytes, for a one-byte content", () => {
    const { container } = renderWith({ content: "+" });
    expect(container.textContent).toContain("Content · 1 byte");
    expect(container.textContent).not.toContain("1 bytes");
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

describe("EventDetailView payload sections", () => {
  function renderEvent(
    overrides: Partial<SigningRequest["event"]> = {},
    props: Partial<Parameters<typeof EventDetailView>[0]> = {}
  ) {
    const base = makeRequest(1);
    const request: SigningRequest = {
      ...base,
      event: { ...base.event, ...overrides },
      signingPubkey: "ab".repeat(32),
    };
    const onResolve = vi.fn();
    const onBack = vi.fn();
    const container = render(
      <EventDetailView
        request={request}
        signingKey={null}
        countdown={65}
        onResolve={onResolve}
        onBack={onBack}
        {...props}
      />
    );
    return { container, onResolve, onBack };
  }

  it("titles the request by kind and shows the countdown", () => {
    const { container } = renderEvent();
    expect(container.querySelector("h1")?.textContent).toBe("Short Text Note request");
    const timer = container.querySelector('[role="timer"]');
    expect(timer?.textContent).toBe("1:05");
    expect(timer?.getAttribute("aria-label")).toBe("Expires in 1:05");
  });

  it("states the consequence of signing for the kind", () => {
    const { container } = renderEvent({ kind: 5 });
    expect(container.textContent).toContain("ask relays to delete your posts");
  });

  it("falls back to a general consequence for an unlisted kind", () => {
    const { container } = renderEvent({ kind: 31_234 });
    expect(container.textContent).toContain(
      "Once signed, anyone holding this event can publish it as yours."
    );
  });

  it("shows the event's own created_at, year included", () => {
    const { container } = renderEvent({ created_at: 946_684_800 });
    const facts = container.querySelector('section[aria-label="Request facts"]')!;
    expect(facts.textContent).toContain("2000");
  });

  it("lists the tags with count and byte length, escaped", () => {
    const { container } = renderEvent({
      tags: [
        ["p", "cd".repeat(32)],
        ["t", "gm​"],
      ],
    });
    expect(container.textContent).toMatch(/Tags · 2 · \d+ bytes/);
    const json = container.querySelector('[data-testid="approval-tags-json"]')!;
    expect(json.textContent).toContain('"p"');
    expect(json.textContent).toContain("cd".repeat(32));
  });

  it("counts hidden characters in tags as part of what is signed", () => {
    const { container } = renderEvent({ content: "plain", tags: [["t", "a‮b"]] });
    expect(container.textContent).toContain("1 hidden or direction-control character is present");
  });

  it("says plural when several characters are hidden", () => {
    const { container } = renderEvent({ content: "‮a‮b" });
    expect(container.textContent).toContain("2 hidden or direction-control characters are present");
  });

  it("omits the tags section for an event with no tags", () => {
    const { container } = renderEvent({ tags: [] });
    expect(container.querySelector('[data-testid="approval-tags-json"]')).toBeNull();
    expect(container.textContent).not.toContain("Tags ·");
  });

  it("marks empty content as empty rather than blank", () => {
    const { container } = renderEvent({ content: "" });
    expect(container.textContent).toContain("(empty)");
    expect(container.textContent).toContain("Content · 0 bytes");
  });

  it("reveals the raw envelope with the signing pubkey and event id", () => {
    const { container } = renderEvent({ content: "hello", tags: [["e", "x"]] });
    const toggle = findButton(container, "View raw JSON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="approval-raw-json"]')).toBeNull();

    click(toggle);
    const raw = container.querySelector('[data-testid="approval-raw-json"]');
    const parsed = JSON.parse(raw?.textContent ?? "{}");
    expect(parsed).toEqual({
      kind: 1,
      content: "hello",
      tags: [["e", "x"]],
      created_at: 1_735_689_600,
      pubkey: "ab".repeat(32),
      id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(raw?.querySelector(".text-\\[var\\(--ink-violet\\)\\]")?.textContent).toBe('"kind"');
    expect(findButton(container, "Hide raw JSON").getAttribute("aria-expanded")).toBe("true");

    click(findButton(container, "Hide raw JSON"));
    expect(container.querySelector('[data-testid="approval-raw-json"]')).toBeNull();
  });

  it("highlights literals in the raw envelope", () => {
    const base = makeRequest(1);
    const container = render(
      <EventDetailView
        request={{ ...base, signingPubkey: undefined }}
        signingKey={null}
        countdown={30}
        onResolve={vi.fn()}
        onBack={vi.fn()}
      />
    );
    click(findButton(container, "View raw JSON"));
    const raw = container.querySelector('[data-testid="approval-raw-json"]')!;
    expect(JSON.parse(raw.textContent ?? "{}").pubkey).toBeUndefined();
    expect(raw.querySelector(".text-\\[var\\(--ink-amber\\)\\]")?.textContent).toBe("1");
  });

  it("names the signing key when the selected key is the bound key", () => {
    const { container } = renderEvent({}, {
      signingKey: { id: "k", label: "Main key", pubkey: "ab".repeat(32) } as never,
    });
    const facts = container.querySelector('section[aria-label="Request facts"]')!;
    expect(facts.textContent).toContain("Main key");
    expect(facts.textContent).toContain("ababababab…abababab");
  });

  it("copies the exact content, not the escaped display, and confirms", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderEvent({ content: "a‮b" });
    await act(async () => {
      findButton(container, "Copy").click();
    });
    expect(writeText).toHaveBeenCalledWith("a‮b");
    expect(findButton(container, "Copy").querySelector(".lucide-check")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1_600);
    });
    expect(findButton(container, "Copy").querySelector(".lucide-check")).toBeNull();
  });

  it("shows no confirmation when the clipboard refuses", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderEvent({ content: "abc" });
    await act(async () => {
      findButton(container, "Copy").click();
    });
    expect(findButton(container, "Copy").querySelector(".lucide-check")).toBeNull();
  });

  it("denies once without remember and signs once for an unremembered approval", () => {
    const { container, onResolve } = renderEvent({ kind: 7 });
    click(findButton(container, "Deny"));
    expect(onResolve).toHaveBeenLastCalledWith("deny");
    settleApprove();
    click(findButton(container, "Approve & sign"));
    expect(onResolve).toHaveBeenLastCalledWith("allow_once");
  });

  it("disables both decisions while one is being resolved", () => {
    const { container } = renderEvent({}, { isResolving: true });
    settleApprove();
    expect((findButton(container, "Approve & sign") as HTMLButtonElement).disabled).toBe(true);
    expect((findButton(container, "Deny") as HTMLButtonElement).disabled).toBe(true);
  });

  it("returns to the queue from the back control", () => {
    const { container, onBack } = renderEvent();
    click(container.querySelector('button[aria-label="Back to approval queue"]')!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides the back control when told to", () => {
    const { container } = renderEvent({}, { showBackButton: false });
    expect(container.querySelector('button[aria-label="Back to approval queue"]')).toBeNull();
  });

  it.each([
    ["trusted", "Trusted"],
    ["first_visit", "First visit"],
  ] as const)("shows the %s trust chip beside the origin", (trust, label) => {
    const { container } = renderEvent({}, { originTrust: trust });
    const site = container.querySelector('section[aria-label="Requesting site"]')!;
    expect(site.textContent).toContain(label);
  });

  it("reveals the scope of a remembered choice only once ticked", () => {
    const { container } = renderEvent({ kind: 7 });
    const scope = container.querySelector<HTMLElement>('[data-testid="remember-scope-copy"] [id$="-description"]')!;
    expect(scope.hidden).toBe(true);
    const checkbox = container.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    expect(checkbox.getAttribute("aria-describedby")).toBe(scope.id);
    click(checkbox);
    expect(scope.hidden).toBe(false);
  });
});

describe("EventDetailView automatic-signing budget notice", () => {
  function renderOverBudget(over: boolean) {
    const onResolve = vi.fn();
    const request = {
      ...makeRequest(7),
      ...(over && { exceededAutoSignBudget: true as const }),
    };
    const container = render(
      <EventDetailView
        request={request}
        signingKey={null}
        countdown={30}
        originTrust="trusted"
        onResolve={onResolve as (action: ApprovalAction) => void}
        onBack={vi.fn()}
      />
    );
    return { container, onResolve };
  }

  it("says the site went over its automatic-signing limit when it did", () => {
    const { container } = renderOverBudget(true);
    const notice = container.querySelector(
      "[data-testid='auto-sign-budget-notice']"
    );

    expect(notice?.textContent).toContain("went over its automatic-signing limit");
    expect(notice?.textContent).toContain("need your approval");
    // The trust chip is unchanged: the site is still trusted, and the notice is
    // what explains why it is being asked anyway.
    expect(container.textContent).toContain("Trusted");
  });

  it("shows no notice for an ordinary request", () => {
    const { container } = renderOverBudget(false);

    expect(
      container.querySelector("[data-testid='auto-sign-budget-notice']")
    ).toBeNull();
  });

  it("does not change what approving does", () => {
    const { container, onResolve } = renderOverBudget(true);

    settleApprove();
    click(findButton(container, "Approve & sign"));

    expect(onResolve).toHaveBeenCalledWith("allow_once");
  });
});

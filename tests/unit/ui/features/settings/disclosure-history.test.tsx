/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ActivityLogEntry } from "@/domain/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const activityGetRecent = vi.fn();

vi.mock("@/infrastructure/messaging/client", () => ({
  activityGetRecent: (...args: unknown[]) => activityGetRecent(...args),
}));

const { DisclosureHistory } = await import(
  "@/ui/features/settings/components/shared/DisclosureHistory"
);

/**
 * The point of this surface: an origin that ONLY reads the public key never
 * gets a stored policy record, because a policy record is written by a signing
 * decision. So it never appears in `OriginPolicyTable`, which is driven by
 * `settings.origins` — and an analytics or session-replay script that never
 * calls `signEvent` is exactly the category the user cannot otherwise see.
 */

const entry = (
  overrides: Partial<ActivityLogEntry> & Pick<ActivityLogEntry, "origin">
): ActivityLogEntry => ({
  id: crypto.randomUUID(),
  timestamp: 1_735_689_600,
  decision: "allow",
  ...overrides,
});

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<DisclosureHistory />);
  });
  mounted.push({ root, container });
  return container;
}

beforeEach(() => {
  activityGetRecent.mockReset();
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("disclosure history", () => {
  it("lists an origin that has only ever read the key", async () => {
    activityGetRecent.mockResolvedValue({
      entries: [
        entry({
          origin: "https://tracker.example",
          operation: "identity_disclosure",
        }),
      ],
      total: 1,
    });

    const container = await render();

    expect(container.textContent).toContain("tracker.example");
  });

  it("ignores signing entries", async () => {
    activityGetRecent.mockResolvedValue({
      entries: [entry({ origin: "https://signer.example", kind: 1 })],
      total: 1,
    });

    const container = await render();

    expect(container.textContent).not.toContain("signer.example");
    expect(container.textContent).toMatch(/no site has read your public key/i);
  });

  it("counts reads and refusals separately for one origin", async () => {
    activityGetRecent.mockResolvedValue({
      entries: [
        entry({
          origin: "https://poll.example",
          operation: "identity_disclosure",
          decision: "allow",
        }),
        entry({
          origin: "https://poll.example",
          operation: "identity_disclosure",
          decision: "allow",
        }),
        entry({
          origin: "https://poll.example",
          operation: "identity_disclosure",
          decision: "deny",
          reason: "rate_limited",
        }),
      ],
      total: 3,
    });

    const container = await render();

    const row = container.querySelector(
      '[data-testid="disclosure-origin-https://poll.example"]'
    );
    expect(row?.textContent).toContain("2 reads");
    expect(row?.textContent).toContain("1 refused");
  });

  it("says the history is unavailable rather than claiming nobody read the key", async () => {
    // A locked background rejects the read. Rendering "No site has read your
    // public key yet" there would be a false assurance.
    activityGetRecent.mockRejectedValue(new Error("rpc:activity:locked"));

    const container = await render();

    expect(container.textContent).toMatch(/unavailable while the vault is locked/i);
    expect(container.textContent).not.toMatch(/no site has read/i);
  });
});

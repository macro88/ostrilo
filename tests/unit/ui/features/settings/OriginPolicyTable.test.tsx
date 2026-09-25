/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OriginPolicy } from "@/domain/types";
import { OriginPolicyTable } from "@/ui/features/settings/components/shared";
import { buttonByText, click, render, unmountAll } from "./settings-dom";

const ORIGIN = "https://primal.net";

function site(overrides: Partial<OriginPolicy> = {}): OriginPolicy {
  return {
    origin: ORIGIN,
    trustLevel: "medium",
    rules: {},
    updatedAt: 1,
    ...overrides,
  };
}

function table(
  origins: OriginPolicy[],
  props: Partial<Parameters<typeof OriginPolicyTable>[0]> = {}
) {
  return render(
    <OriginPolicyTable
      origins={origins}
      onRemove={vi.fn()}
      onToggleSession={vi.fn()}
      {...props}
    />
  );
}

function row(container: HTMLElement, origin = ORIGIN) {
  return container.querySelector<HTMLButtonElement>(
    `[data-testid="origin-row-${origin}"]`
  )!;
}

function panel(container: HTMLElement, origin = ORIGIN) {
  return container.querySelector<HTMLElement>(`[id="origin-panel-${origin}"]`)!;
}

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("OriginPolicyTable", () => {
  it("explains when a site is listed if there are none", () => {
    const container = table([]);

    expect(container.textContent).toBe(
      "No sites yet. A site is listed once a decision about it is recorded."
    );
  });

  it("opens and closes a site's details from its row", async () => {
    const container = table([site(), site({ origin: "https://snort.social" })]);

    expect(row(container).getAttribute("aria-expanded")).toBe("false");
    expect(panel(container).hidden).toBe(true);

    await click(row(container));

    expect(row(container).getAttribute("aria-expanded")).toBe("true");
    expect(panel(container).hidden).toBe(false);
    expect(panel(container, "https://snort.social").hidden).toBe(true);

    await click(row(container));

    expect(panel(container).hidden).toBe(true);
  });

  it("leads with a site's stored name and keeps the origin beside it", () => {
    const container = table([site({ name: "Primal", trustLevel: "low" })]);

    expect(row(container).textContent).toContain("Primal");
    expect(row(container).textContent).toContain("primal.net");
    expect(row(container).textContent).toContain("Low trust");
  });

  it.each([
    ["allow", "Can read your public key", "This site can read your public key", true],
    ["deny", "Refused your public key", "This site is refused your public key", true],
    [undefined, "Asks before reading your key", "You will be asked next time this site wants it", false],
  ] as const)(
    "describes a %s public-key decision and offers revoke only when one is recorded",
    (decision, short, full, revocable) => {
      const onRevokeDisclosure = vi.fn();
      const container = table([site({ identityDisclosure: decision })], {
        onRevokeDisclosure,
      });

      expect(row(container).textContent).toContain(short);
      const section = container.querySelector(
        `[data-testid="origin-disclosure-${ORIGIN}"]`
      )!;
      expect(section.textContent).toContain(full);
      expect(
        Array.from(section.querySelectorAll("button")).some(
          (button) => button.textContent === "Revoke"
        )
      ).toBe(revocable);
    }
  );

  it("revokes the disclosure for the site whose Revoke was pressed", async () => {
    const onRevokeDisclosure = vi.fn();
    const container = table([site({ identityDisclosure: "deny" })], {
      onRevokeDisclosure,
    });

    await click(buttonByText(panel(container), "Revoke"));

    expect(onRevokeDisclosure).toHaveBeenCalledWith(ORIGIN);
  });

  it("marks a live grant with its expiry and ignores the stale display flag", () => {
    const expiresAt = new Date(2026, 8, 25, 14, 30).getTime();
    const container = table(
      [site(), site({ origin: "https://snort.social", sessionGrantAll: true })],
      { sessionGrants: [{ origin: ORIGIN, expiresAt }] }
    );

    expect(row(container).textContent).toContain("Session");
    expect(panel(container).textContent).toContain(
      `expires ${new Date(expiresAt).toLocaleTimeString()}`
    );
    expect(row(container, "https://snort.social").textContent).not.toContain(
      "Session"
    );
    expect(panel(container, "https://snort.social").textContent).toContain(
      "Ends when the grant expires or the vault locks."
    );
  });

  it("falls back to the stored flag when no live grants are supplied", () => {
    const container = table([site({ sessionGrantAll: true })]);

    expect(row(container).textContent).toContain("Session");
    expect(
      panel(container).querySelector('[role="switch"]')?.getAttribute("aria-checked")
    ).toBe("true");
  });

  it("reports the switch position to the caller", async () => {
    const onToggleSession = vi.fn();
    const container = table([site()], { onToggleSession, sessionGrants: [] });

    await click(panel(container).querySelector('[role="switch"]')!);

    expect(onToggleSession).toHaveBeenCalledWith(ORIGIN, true);
  });

  it("hides the rules section without a rule handler", () => {
    const container = table([site()]);

    expect(panel(container).textContent).not.toContain("Rules by kind");
    expect(container.querySelector('[data-testid^="origin-policy-kind-"]')).toBeNull();
  });

  it("lists a kind with a stored rule alongside the quick kinds and skips malformed keys", () => {
    const rules = { 30023: "deny", nonsense: "allow" } as unknown as OriginPolicy["rules"];
    const container = table([site({ rules })], { onSetPerKindRule: vi.fn() });

    const kinds = Array.from(
      container.querySelectorAll('[data-testid^="origin-policy-kind-"]')
    ).map((element) => element.getAttribute("data-testid"));
    expect(kinds).toContain("origin-policy-kind-30023");
    expect(kinds).toContain("origin-policy-kind-0");
    expect(kinds).not.toContain("origin-policy-kind-NaN");
    expect(
      container.querySelector('[data-testid="origin-policy-effective-30023"]')
        ?.textContent
    ).toContain("Refused — from a rule you set.");
  });

  it("removes a site only when the confirmation is accepted", async () => {
    const onRemove = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = table([site({ name: "Primal" })], { onRemove });

    await click(buttonByText(panel(container), "Remove site"));
    expect(confirm).toHaveBeenCalledWith(
      "Remove policy for Primal? This action cannot be undone."
    );
    expect(onRemove).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await click(buttonByText(panel(container), "Remove site"));

    expect(onRemove).toHaveBeenCalledWith(ORIGIN);
  });
});

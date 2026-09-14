/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"http://localhost/options.html"}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { OptionsApp } from "@/extension/options/OptionsApp";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/ui/hooks/useTheme", () => ({
  useTheme: vi.fn(),
}));

// The options page is now gated on lock state, so these tests must present
// an unlocked vault with keys to reach the tabs at all.
const keyManagerState = {
  isLocked: false,
  isLoading: false,
  isInitialising: false,
  hasKeys: true,
};

vi.mock("@/ui/state/KeyManagerContext", () => ({
  KeyManagerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useKeyManagerContext: () => keyManagerState,
}));

vi.mock("@/ui/features/authentication/components/LockScreen", () => ({
  LockScreen: () => <section>Lock screen</section>,
}));

vi.mock("@/ui/components/logo/Logo", () => ({
  Logo: () => <div aria-label="Ostrilo" />,
}));

vi.mock("@/ui/features/settings/components/GeneralSettingsTab", () => ({
  GeneralSettingsTab: () => <section>General panel</section>,
}));

vi.mock("@/ui/features/settings/components/KeysIdentitiesTab", () => ({
  KeysIdentitiesTab: () => <section>Keys panel</section>,
}));

vi.mock("@/ui/features/settings/components/SecuritySettingsTab", () => ({
  SecuritySettingsTab: () => <section>Security panel</section>,
}));

vi.mock("@/ui/features/settings/components/PermissionsTab", () => ({
  PermissionsTab: () => <section>Permissions panel</section>,
}));

vi.mock("@/ui/features/settings/components/ActivityLogTab", () => ({
  ActivityLogTab: () => <section>Activity panel</section>,
}));

vi.mock("@/ui/features/settings/components/RelaysTab", () => ({
  RelaysTab: () => <section>Relays panel</section>,
}));

vi.mock("@/ui/features/settings/components/AdvancedTab", () => ({
  AdvancedTab: () => <section>Advanced panel</section>,
}));

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

function tabByName(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll('[role="tab"]')).find(
    (tab) => tab.textContent?.includes(name)
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/options.html");
  keyManagerState.isLocked = false;
  keyManagerState.isLoading = false;
  keyManagerState.isInitialising = false;
  keyManagerState.hasKeys = true;
});

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  window.history.replaceState(null, "", "/options.html");
  vi.restoreAllMocks();
});

describe("OptionsApp", () => {
  it("renders the full settings tab set", () => {
    const container = render(<OptionsApp />);

    for (const tabName of [
      "General",
      "Keys & Identities",
      "Security",
      "Permissions",
      "Activity Log",
      "Relays",
      "Advanced",
    ]) {
      expect(tabByName(container, tabName)).toBeDefined();
    }
  });

  it("selects the initial tab from the URL hash", () => {
    window.history.replaceState(null, "", "/options.html#security");

    const container = render(<OptionsApp />);

    expect(tabByName(container, "Security")?.getAttribute("data-state")).toBe(
      "active"
    );
    expect(container.textContent).toContain("Security panel");
  });

  it("updates the URL hash during keyboard tab navigation", () => {
    const container = render(<OptionsApp />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      );
    });

    expect(window.location.hash).toBe("#keys");
    expect(
      tabByName(container, "Keys & Identities")?.getAttribute("data-state")
    ).toBe(
      "active"
    );
  });
});

describe("OptionsApp lock gating", () => {
  it("renders the lock screen, not the tabs, when the vault is locked", () => {
    // The defect: the options page had no lock check at all. With the vault
    // locked it still rendered every key label and public key, every origin
    // policy, the relay list and the activity log.
    keyManagerState.isLocked = true;
    const container = render(<OptionsApp />);

    expect(container.textContent).toContain("Lock screen");
    for (const panel of [
      "Keys panel",
      "Permissions panel",
      "Relays panel",
      "Activity panel",
      "Security panel",
    ]) {
      expect(
        container.textContent,
        `SECURITY REGRESSION: ${panel} rendered behind a locked vault`
      ).not.toContain(panel);
    }
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("shows onboarding guidance rather than a password prompt on a fresh install", () => {
    keyManagerState.isLocked = true;
    keyManagerState.hasKeys = false;
    const container = render(<OptionsApp />);

    expect(container.textContent).toContain("Create a key");
    expect(container.textContent).not.toContain("Lock screen");
  });

  it("returns the user to the requested tab after unlocking", () => {
    // The tab lives above the gate, so unlocking swaps the gate's children
    // back in without losing where the user was heading.
    window.history.replaceState(null, "", "/options.html#relays");
    keyManagerState.isLocked = true;

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => root.render(<OptionsApp />));
    expect(container.textContent).toContain("Lock screen");

    keyManagerState.isLocked = false;
    act(() => root.render(<OptionsApp />));

    const selected = Array.from(
      container.querySelectorAll('[role="tab"]')
    ).find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Relays");
  });
});

describe("OptionsGate loading behaviour", () => {
  it("keeps the lock screen mounted while an unlock is in flight", () => {
    // The gate used to hide the whole tree on `isLoading`, which is also true
    // for the duration of an unlock. The lock screen was therefore unmounted
    // the moment the user pressed Unlock and remounted afterwards with fresh
    // state, discarding the failure message it had just been given. Only the
    // e2e suite could see it; this is the cheap guard.
    keyManagerState.isLocked = true;
    keyManagerState.isLoading = true;
    keyManagerState.isInitialising = false;

    const container = render(<OptionsApp />);

    expect(container.textContent).toContain("Lock screen");
  });

  it("renders nothing until the first lock-state read resolves", () => {
    keyManagerState.isInitialising = true;

    const container = render(<OptionsApp />);

    expect(container.textContent).not.toContain("Lock screen");
    expect(container.textContent).not.toContain("Create a key");
  });
});

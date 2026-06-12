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

vi.mock("@/ui/state/KeyManagerContext", () => ({
  KeyManagerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
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

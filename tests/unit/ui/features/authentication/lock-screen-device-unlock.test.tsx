/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url":"http://localhost/popup.html"}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BiometricStatus } from "@/application/services/biometric-factor.service";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let status: BiometricStatus | null = null;
const openUnlockWindow = vi.fn();

vi.mock("@/ui/hooks/useBiometricStatus", () => ({
  useBiometricStatus: () => ({ status, refresh: vi.fn() }),
}));
vi.mock("@/ui/lib/open-unlock-window", () => ({ openUnlockWindow }));
vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ unlock: vi.fn(), isLoading: false }),
}));
vi.mock("@/ui/components/logo/Logo", () => ({
  Logo: () => <div aria-label="Ostrilo" />,
}));

const { LockScreen } = await import(
  "@/ui/features/authentication/components/LockScreen"
);

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderLockScreen(next: BiometricStatus | null) {
  status = next;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<LockScreen />));
  mounted.push({ root, container });
  return container;
}

const buttons = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
const DEVICE_BUTTON = "Unlock with your device";

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  openUnlockWindow.mockClear();
});

describe("LockScreen device unlock", () => {
  it.each([
    ["the background says nothing", null],
    ["no factor is enrolled", { enrolled: false }],
  ])("renders no affordance and no explanation when %s", (_name, next) => {
    const container = renderLockScreen(next);
    expect(buttons(container)).not.toContain(DEVICE_BUTTON);
    expect(container.querySelector('[data-testid="device-unlock-note"]')).toBeNull();
    expect(container.querySelector("button[disabled]")).toBeNull();
  });

  it("offers the factor when it would work, and opens the unlock window", () => {
    const container = renderLockScreen({ enrolled: true, enrolledAt: 1 });
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === DEVICE_BUTTON
    )!;

    expect(button.getAttribute("type")).toBe("button");
    act(() => button.click());
    expect(openUnlockWindow).toHaveBeenCalledTimes(1);
  });

  it.each(["restart_pending", "rehearsal_due", "rotation_pending", "legacy_records"] as const)(
    "withdraws the button and explains when the password is needed (%s)",
    (passwordNeeded) => {
      const container = renderLockScreen({ enrolled: true, enrolledAt: 1, passwordNeeded });

      expect(buttons(container)).not.toContain(DEVICE_BUTTON);
      const note = container.querySelector('[data-testid="device-unlock-note"]');
      expect(note?.textContent).toMatch(/password/i);
      expect(note?.getAttribute("role")).not.toBe("alert");
    }
  );
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonByText,
  byLabel,
  cancelReauth,
  click,
  confirmReauth,
  flush,
  reauthDialog,
  render,
  unmountAll,
} from "./settings-dom";
import { choose, selectWithOption, slideTo } from "./settings-native-controls";

const deps = vi.hoisted(() => ({
  isLoading: false,
  updateTheme: vi.fn(),
  updateAutoLockMinutes: vi.fn(),
  lock: vi.fn(),
  openOptionsTab: vi.fn(),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: { theme: "light", autoLockMinutes: 5 },
    isLoading: deps.isLoading,
    updateTheme: deps.updateTheme,
    updateAutoLockMinutes: deps.updateAutoLockMinutes,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ lock: deps.lock }),
}));

vi.mock("@/ui/lib/open-options", () => ({
  openOptionsTab: deps.openOptionsTab,
}));

vi.mock("@/infrastructure/messaging/client", () => ({
  evaluatePasswordStrength: vi.fn(),
}));

vi.mock("@/components/common/AutoLockCountdown", () => ({
  AutoLockCountdown: () => null,
}));

vi.mock("@/components/ui/select", async () =>
  (await import("./settings-native-controls")).selectModule
);

vi.mock("@/components/ui/slider", async () =>
  (await import("./settings-native-controls")).sliderModule
);

import { BasicSettings } from "@/ui/features/settings/components/BasicSettings";

beforeEach(() => {
  deps.isLoading = false;
  deps.updateTheme.mockReset();
  deps.updateAutoLockMinutes.mockReset().mockResolvedValue(undefined);
  deps.lock.mockReset();
  deps.openOptionsTab.mockReset();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("BasicSettings", () => {
  it("shows a busy placeholder and no controls while settings load", () => {
    deps.isLoading = true;
    const container = render(<BasicSettings />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("Lock now");
  });

  it("applies a theme choice straight away", async () => {
    const container = render(<BasicSettings />);

    await choose(selectWithOption(container, "dark"), "dark");

    expect(deps.updateTheme).toHaveBeenCalledWith("dark");
  });

  it("changes the auto-lock timeout only with the re-entered password", async () => {
    const container = render(<BasicSettings />);

    await slideTo(byLabel<HTMLInputElement>(container, "Auto-lock timeout"), 20);

    expect(deps.updateAutoLockMinutes).not.toHaveBeenCalled();
    expect(reauthDialog()?.textContent).toContain(
      "Change the auto-lock timeout to 20 minutes."
    );

    await confirmReauth("pw");

    expect(deps.updateAutoLockMinutes).toHaveBeenCalledWith(20, "pw");
  });

  it("leaves the auto-lock timeout unchanged when the dialog is cancelled", async () => {
    const container = render(<BasicSettings />);
    const slider = byLabel<HTMLInputElement>(container, "Auto-lock timeout");

    await slideTo(slider, 20);
    await cancelReauth();
    await flush();

    expect(deps.updateAutoLockMinutes).not.toHaveBeenCalled();
    expect(slider.value).toBe("5");
  });

  it("opens the settings page on the tab each row names", async () => {
    const container = render(<BasicSettings />);

    await click(buttonByText(container, "Keys & identities"));
    await click(buttonByText(container, "Site permissions"));
    await click(buttonByText(container, "All settings"));

    expect(deps.openOptionsTab.mock.calls).toEqual([
      ["keys"],
      ["permissions"],
      [undefined],
    ]);
  });

  it("locks the vault from the Lock now button", async () => {
    const container = render(<BasicSettings />);

    await click(buttonByText(container, "Lock now"));

    expect(deps.lock).toHaveBeenCalledTimes(1);
  });
});

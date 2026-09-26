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
import { slideTo } from "./settings-native-controls";

const settingsHook = vi.hoisted(() => ({
  isLoading: false,
  updateAutoLockMinutes: vi.fn(),
  updateSessionTTLMinutes: vi.fn(),
  resetSettings: vi.fn(),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: { autoLockMinutes: 5, sessionTTLMinutes: 15 },
    ...settingsHook,
  }),
}));

vi.mock("@/infrastructure/messaging/client", () => ({
  evaluatePasswordStrength: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("@/components/common/AutoLockCountdown", () => ({
  AutoLockCountdown: () => null,
}));

vi.mock("@/components/ui/slider", async () =>
  (await import("./settings-native-controls")).sliderModule
);

import { SecuritySettingsTab } from "@/ui/features/settings/components/SecuritySettingsTab";

beforeEach(() => {
  settingsHook.isLoading = false;
  settingsHook.updateAutoLockMinutes.mockReset().mockResolvedValue(undefined);
  settingsHook.updateSessionTTLMinutes.mockReset().mockResolvedValue(undefined);
  settingsHook.resetSettings.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("SecuritySettingsTab", () => {
  it("renders the loading skeleton and no controls while settings load", () => {
    settingsHook.isLoading = true;
    const container = render(<SecuritySettingsTab />);

    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(container.textContent).not.toContain("Reset All Settings");
  });

  it("writes the new auto-lock timeout with the confirmed password", async () => {
    const container = render(<SecuritySettingsTab />);

    await slideTo(byLabel<HTMLInputElement>(container, "Auto-lock timeout"), 30);

    expect(reauthDialog()?.textContent).toContain(
      "Change the auto-lock timeout to 30 minutes."
    );
    expect(settingsHook.updateAutoLockMinutes).not.toHaveBeenCalled();

    await confirmReauth("pw");

    expect(settingsHook.updateAutoLockMinutes).toHaveBeenCalledWith(30, "pw");
    expect(container.textContent).toContain("30 min");
  });

  it("puts the auto-lock slider back when the password is not given", async () => {
    const container = render(<SecuritySettingsTab />);
    const slider = byLabel<HTMLInputElement>(container, "Auto-lock timeout");

    await slideTo(slider, 30);
    await cancelReauth();
    await flush();

    expect(settingsHook.updateAutoLockMinutes).not.toHaveBeenCalled();
    expect(slider.value).toBe("5");
  });

  it("writes the new session grant timeout with the confirmed password", async () => {
    const container = render(<SecuritySettingsTab />);

    await slideTo(
      byLabel<HTMLInputElement>(container, "Session grant timeout"),
      45
    );

    expect(reauthDialog()?.textContent).toContain(
      "Change the session grant timeout to 45 minutes."
    );
    await confirmReauth("pw");

    expect(settingsHook.updateSessionTTLMinutes).toHaveBeenCalledWith(45, "pw");
  });

  it("shows the background's refusal when a timeout write is rejected", async () => {
    settingsHook.updateSessionTTLMinutes.mockRejectedValueOnce(
      new Error("Password verification failed")
    );
    const container = render(<SecuritySettingsTab />);

    await slideTo(
      byLabel<HTMLInputElement>(container, "Session grant timeout"),
      45
    );
    await confirmReauth("wrong");

    expect(reauthDialog()?.textContent).toContain("Password verification failed");
  });

  it("resets settings only with the password", async () => {
    const container = render(<SecuritySettingsTab />);

    await click(buttonByText(container, "Reset All Settings"));
    expect(reauthDialog()?.textContent).toContain(
      "Reset all settings to their defaults."
    );
    expect(settingsHook.resetSettings).not.toHaveBeenCalled();

    await confirmReauth("pw");

    expect(settingsHook.resetSettings).toHaveBeenCalledWith("pw");
  });

  it("resets nothing when the reset is cancelled", async () => {
    const container = render(<SecuritySettingsTab />);

    await click(buttonByText(container, "Reset All Settings"));
    await cancelReauth();

    expect(settingsHook.resetSettings).not.toHaveBeenCalled();
    expect(reauthDialog()).toBeNull();
  });
  it("opens the change-password dialog from its own row, and closes it", async () => {
    const container = render(<SecuritySettingsTab />);
    expect(document.body.querySelector("#change-current-password")).toBeNull();

    await click(buttonByText(container, "Change password"));

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Change master password");
    expect(document.body.querySelector("#change-current-password")).not.toBeNull();

    await click(buttonByText(document.body, "Cancel"));
    await flush();
    expect(document.body.querySelector("#change-current-password")).toBeNull();
  });
});

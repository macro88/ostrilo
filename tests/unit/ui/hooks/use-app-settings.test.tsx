// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS_V1, type AppSettingsV1 } from "@/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  subscribeSettingsChanged: vi.fn(),
  policySetOrigin: vi.fn(),
  policySetKindRule: vi.fn(),
  policyClearSession: vi.fn(),
  policyRemoveOrigin: vi.fn(),
  policySetSession: vi.fn(),
  activityClear: vi.fn(),
  reportActivity: vi.fn(),
}));

vi.mock("@/infrastructure/messaging/client", () => rpc);

type UseAppSettings = typeof import("@/ui/hooks/useAppSettings").useAppSettings;
type Settings = ReturnType<UseAppSettings>;

const stored: AppSettingsV1 = {
  ...DEFAULT_SETTINGS_V1,
  theme: "dark",
  relays: ["wss://one.example", "wss://two.example"],
};

let container: HTMLDivElement;
let root: Root;
let current: Settings | null;
let useAppSettings: UseAppSettings;

function Harness() {
  current = useAppSettings();
  return null;
}

function hook(): Settings {
  if (!current) throw new Error("harness has not rendered");
  return current;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function mount() {
  act(() => root.render(<Harness />));
  await settle();
}

function externalChange() {
  const [[onChanged]] = rpc.subscribeSettingsChanged.mock.calls as [[() => void]];
  onChanged();
}

describe("useAppSettings", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const fn of Object.values(rpc)) fn.mockReset();
    rpc.getSettings.mockResolvedValue(stored);
    rpc.updateSettings.mockResolvedValue(stored);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ({ useAppSettings } = await import("@/ui/hooks/useAppSettings"));
    current = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  describe("loading", () => {
    it("reports loading with shipped defaults until the background answers", async () => {
      const pending = Promise.withResolvers<AppSettingsV1>();
      rpc.getSettings.mockReturnValueOnce(pending.promise);

      act(() => root.render(<Harness />));
      expect(hook().isLoading).toBe(true);
      expect(hook().settings).toEqual(DEFAULT_SETTINGS_V1);

      pending.resolve(stored);
      await settle();

      expect(hook().isLoading).toBe(false);
      expect(hook().settings.theme).toBe("dark");
      expect(hook().settings.relays).toEqual(stored.relays);
    });

    it("fills fields missing from an older stored record with defaults", async () => {
      const { sessionTTLMinutes: _dropped, ...legacy } = stored;
      rpc.getSettings.mockResolvedValueOnce(legacy);

      await mount();

      expect(hook().settings.theme).toBe("dark");
      expect(hook().settings.sessionTTLMinutes).toBe(
        DEFAULT_SETTINGS_V1.sessionTTLMinutes
      );
    });

    it("falls back to defaults when the background has no settings", async () => {
      rpc.getSettings.mockResolvedValueOnce(null);

      await mount();

      expect(hook().isLoading).toBe(false);
      expect(hook().settings).toEqual(DEFAULT_SETTINGS_V1);
    });

    it("stops loading on defaults when the read fails", async () => {
      rpc.getSettings.mockRejectedValueOnce(new Error("no_response"));

      await mount();

      expect(hook().isLoading).toBe(false);
      expect(hook().settings).toEqual(DEFAULT_SETTINGS_V1);
    });

    it("shares one read between every consumer on the surface", async () => {
      const second = createRoot(document.createElement("div"));
      await mount();
      act(() => second.render(<Harness />));
      await settle();

      expect(rpc.getSettings).toHaveBeenCalledTimes(1);
      expect(hook().settings.theme).toBe("dark");
      act(() => second.unmount());
    });

    it("rereads after another surface reports a change", async () => {
      await mount();
      rpc.getSettings.mockResolvedValueOnce({ ...stored, theme: "light" });

      act(() => externalChange());
      await settle();

      expect(hook().settings.theme).toBe("light");
    });

    it("ignores a change notice that arrives before the first read completes", async () => {
      const pending = Promise.withResolvers<AppSettingsV1>();
      rpc.getSettings.mockReturnValueOnce(pending.promise);
      act(() => root.render(<Harness />));

      act(() => externalChange());
      pending.resolve(stored);
      await settle();

      expect(rpc.getSettings).toHaveBeenCalledTimes(1);
      expect(hook().settings.theme).toBe("dark");
    });
  });

  describe("general updates", () => {
    beforeEach(mount);

    it("sends each field as a patch and records the change as activity", async () => {
      await hook().updateTheme("light");
      await hook().updateSidePanel(true);
      await hook().updateMaxActivityEntries(200);

      expect(rpc.updateSettings.mock.calls).toEqual([
        [{ theme: "light" }, undefined],
        [{ sidePanel: true }, undefined],
        [{ maxActivityEntries: 200 }, undefined],
      ]);
      expect(rpc.reportActivity).toHaveBeenCalledTimes(3);
    });

    it("forwards the password for the timeouts the background gates", async () => {
      await hook().updateAutoLockMinutes(30, "pw");
      await hook().updateSessionTTLMinutes(15, "pw");

      expect(rpc.updateSettings.mock.calls).toEqual([
        [{ autoLockMinutes: 30 }, "pw"],
        [{ sessionTTLMinutes: 15 }, "pw"],
      ]);
    });

    it("propagates a refused update without recording activity", async () => {
      rpc.updateSettings.mockRejectedValueOnce(new Error("password_required"));

      await expect(hook().updateAutoLockMinutes(60)).rejects.toThrow(
        "password_required"
      );
      expect(rpc.reportActivity).not.toHaveBeenCalled();
    });

    it("drops protected and unknown kinds from the medium allowlist before sending it", async () => {
      await hook().updateMediumAllowKinds([7, 1, 6, 9999, 1.5]);

      expect(rpc.updateSettings).toHaveBeenCalledWith(
        { mediumAllowKinds: [7, 6] },
        undefined
      );
    });
  });

  describe("relays", () => {
    beforeEach(mount);

    it("appends a new relay to the stored list", async () => {
      await hook().addRelay("wss://three.example");

      expect(rpc.updateSettings).toHaveBeenCalledWith(
        { relays: [...stored.relays, "wss://three.example"] },
        undefined
      );
    });

    it("sends nothing when the relay is already listed", async () => {
      const result = hook().addRelay("wss://one.example");

      expect(result).toBeUndefined();
      expect(rpc.updateSettings).not.toHaveBeenCalled();
    });

    it("removes only the named relay", async () => {
      await hook().removeRelay("wss://one.example");

      expect(rpc.updateSettings).toHaveBeenCalledWith(
        { relays: ["wss://two.example"] },
        undefined
      );
    });

    it("replaces the whole list", async () => {
      await hook().updateRelays(["wss://only.example"]);

      expect(rpc.updateSettings).toHaveBeenCalledWith(
        { relays: ["wss://only.example"] },
        undefined
      );
    });
  });

  describe("origin policy", () => {
    beforeEach(mount);

    it("routes policy edits to the policy service with the password", async () => {
      await hook().updateOriginPolicy("https://a.example", { name: "A" }, "pw");
      await hook().updateOriginTrustLevel("https://a.example", "high", "pw");
      await hook().removeOriginPolicy("https://b.example");
      await hook().setPerKindRule("https://a.example", 4, "deny", "pw");

      expect(rpc.policySetOrigin.mock.calls).toEqual([
        ["https://a.example", { name: "A" }, "pw"],
        ["https://a.example", { trustLevel: "high" }, "pw"],
      ]);
      expect(rpc.policyRemoveOrigin).toHaveBeenCalledWith("https://b.example");
      expect(rpc.policySetKindRule).toHaveBeenCalledWith(
        "https://a.example",
        4,
        "deny",
        "pw"
      );
    });

    it("revokes an identity disclosure by writing ask rather than an undefined field", async () => {
      await hook().revokeIdentityDisclosure("https://a.example");

      expect(rpc.policySetOrigin).toHaveBeenCalledWith(
        "https://a.example",
        { identityDisclosure: "ask" },
        undefined
      );
    });

    it("clears a session grant without a password", async () => {
      await hook().setSessionGrant("https://a.example", false);

      expect(rpc.policyClearSession).toHaveBeenCalledWith("https://a.example");
      expect(rpc.policySetSession).not.toHaveBeenCalled();
    });

    it("opens a session grant with the password", async () => {
      await hook().setSessionGrant("https://a.example", true, "pw");

      expect(rpc.policySetSession).toHaveBeenCalledWith(
        "https://a.example",
        true,
        "pw"
      );
      expect(rpc.policyClearSession).not.toHaveBeenCalled();
    });
  });

  describe("reset and activity", () => {
    beforeEach(mount);

    it("resets every patchable field to its default under the supplied password", async () => {
      await hook().resetSettings("pw");

      expect(rpc.updateSettings).toHaveBeenCalledWith(
        {
          theme: DEFAULT_SETTINGS_V1.theme,
          sidePanel: DEFAULT_SETTINGS_V1.sidePanel,
          autoLockMinutes: DEFAULT_SETTINGS_V1.autoLockMinutes,
          maxActivityEntries: DEFAULT_SETTINGS_V1.maxActivityEntries,
          relays: DEFAULT_SETTINGS_V1.relays,
          selectedKeyId: undefined,
          mediumAllowKinds: DEFAULT_SETTINGS_V1.mediumAllowKinds,
          sessionTTLMinutes: DEFAULT_SETTINGS_V1.sessionTTLMinutes,
          onboardingCompleted: undefined,
          onboardingCompletedAt: undefined,
        },
        "pw"
      );
    });

    it("rethrows a refused reset", async () => {
      rpc.updateSettings.mockRejectedValueOnce(new Error("invalid_password"));

      await expect(hook().resetSettings("wrong")).rejects.toThrow(
        "invalid_password"
      );
    });

    it("clears the activity log through the activity RPC", async () => {
      rpc.activityClear.mockResolvedValueOnce(null);

      await hook().clearActivityLog();

      expect(rpc.activityClear).toHaveBeenCalledTimes(1);
    });
  });
});

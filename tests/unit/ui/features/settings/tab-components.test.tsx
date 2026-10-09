/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import type { ActivityLogEntry } from "@/domain/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const appSettingsMock = vi.hoisted(() => ({
  isLoading: false,
  settings: {
    __version: "settings.v1",
    theme: "light",
    sidePanel: false,
    autoLockMinutes: 5,
    maxActivityEntries: 50,
    relays: ["wss://relay.example.com"],
    origins: [] as Array<{
      origin: string;
      trustLevel: "low" | "medium" | "high";
      rules: Record<number, "allow" | "deny" | "ask">;
      updatedAt: number;
      name?: string;
      sessionGrantAll?: boolean;
    }>,
    mediumAllowKinds: [7],
    sessionTTLMinutes: 0,
  },
  updateTheme: vi.fn(),
  updateAutoLockMinutes: vi.fn(),
  updateSessionTTLMinutes: vi.fn(),
  updateMaxActivityEntries: vi.fn(),
  clearActivityLog: vi.fn(),
  addRelay: vi.fn(),
  removeRelay: vi.fn(),
  removeOriginPolicy: vi.fn(),
  setSessionGrant: vi.fn(),
  setPerKindRule: vi.fn(),
  updateMediumAllowKinds: vi.fn(),
  resetSettings: vi.fn(),
  updateSidePanel: vi.fn(),
}));

const keyManagerMock = vi.hoisted(() => ({
  keys: [
    {
      id: "key-1",
      label: "Main key",
      publicKeyBech32: "npub1main000000000000000000000000000000000",
      publicKeyHex: "abc",
    },
  ],
  selectedUnlockedKey: {
    id: "key-1",
    label: "Main key",
    publicKeyBech32: "npub1main000000000000000000000000000000000",
    publicKeyHex: "abc",
  },
  selectKey: vi.fn(),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: appSettingsMock.settings,
    isLoading: appSettingsMock.isLoading,
    updateTheme: appSettingsMock.updateTheme,
    updateAutoLockMinutes: appSettingsMock.updateAutoLockMinutes,
    updateSessionTTLMinutes: appSettingsMock.updateSessionTTLMinutes,
    updateMaxActivityEntries: appSettingsMock.updateMaxActivityEntries,
    clearActivityLog: appSettingsMock.clearActivityLog,
    addRelay: appSettingsMock.addRelay,
    removeRelay: appSettingsMock.removeRelay,
    removeOriginPolicy: appSettingsMock.removeOriginPolicy,
    setSessionGrant: appSettingsMock.setSessionGrant,
    setPerKindRule: appSettingsMock.setPerKindRule,
    updateMediumAllowKinds: appSettingsMock.updateMediumAllowKinds,
    resetSettings: appSettingsMock.resetSettings,
    updateSidePanel: appSettingsMock.updateSidePanel,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => keyManagerMock,
}));

vi.mock("@/ui/hooks/useProfileMetadata", () => ({
  useProfileMetadata: () => ({ profiles: new Map() }),
}));

vi.mock("@/infrastructure/messaging/client", () => ({
  renameKey: vi.fn(),
  deleteKey: vi.fn(),
  activityGetRecent: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
}));

// The "Open extension in" row writes the legacy docking flag and the
// browser's panel behaviour through these hooks. Both reach
// `webextension-polyfill`, which refuses to load outside an extension page.
vi.mock("@/hooks/useWxtStorage", () => ({
  useWxtStorage: () => [false, vi.fn().mockResolvedValue(undefined)],
}));

vi.mock("@/hooks/useSidePanelDock", () => ({
  useSidePanelDock: () => ({
    supported: false,
    enableDocking: vi.fn(),
    disableDocking: vi.fn(),
  }),
}));

vi.mock("@/ui/features/settings/components/shared", () => ({
  // Reads the activity log over RPC; the Permissions tests are about the
  // policy table, not the disclosure history, which has its own test.
  DisclosureHistory: () => <section>Disclosure history</section>,
  ThemeSelector: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: "dark") => void;
  }) => (
    <button type="button" onClick={() => onChange("dark")}>
      Theme selector: {value}
    </button>
  ),
  AutoLockSlider: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (value: number) => void;
  }) => (
    <button type="button" onClick={() => onChange(value + 5)}>
      Auto lock: {value}
    </button>
  ),
  SessionTTLSlider: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (value: number) => void;
  }) => (
    <button type="button" onClick={() => onChange(30)}>
      Session TTL: {value}
    </button>
  ),
  ActivityLogConfig: ({
    maxEntries,
    onChange,
    onClear,
    onExport,
  }: {
    maxEntries: number;
    onChange: (value: number) => void;
    onClear: () => void;
    onExport?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onChange(maxEntries + 10)}>
        Activity entries: {maxEntries}
      </button>
      <button type="button" onClick={onClear}>
        Clear activity
      </button>
      <button type="button" onClick={onExport}>
        Export activity
      </button>
    </div>
  ),
  RelayList: ({
    relays,
    onAdd,
    onRemove,
  }: {
    relays: string[];
    onAdd: (relay: string) => void;
    onRemove: (relay: string) => void;
  }) => (
    <div>
      <span>{relays.join(", ")}</span>
      <button type="button" onClick={() => onAdd("wss://new.example.com")}>
        Add relay
      </button>
      <button type="button" onClick={() => onRemove(relays[0])}>
        Remove relay
      </button>
    </div>
  ),
  MediumKindToggles: ({
    mediumAllowKinds,
    onToggle,
  }: {
    mediumAllowKinds: number[];
    onToggle: (kind: number, enabled: boolean) => void;
  }) => (
    <button
      type="button"
      onClick={() => onToggle(7, !mediumAllowKinds.includes(7))}
    >
      Medium kind toggles
    </button>
  ),
  OriginPolicyTable: ({
    origins,
    onRemove,
    onToggleSession,
    onSetPerKindRule,
  }: {
    origins: typeof appSettingsMock.settings.origins;
    onRemove: (origin: string) => void;
    onToggleSession: (origin: string, enabled: boolean) => void;
    onSetPerKindRule: (
      origin: string,
      kind: number,
      rule: "allow" | "deny" | "ask"
    ) => void;
  }) => (
    <div>
      <span>{origins[0]?.origin}</span>
      <button type="button" onClick={() => onRemove(origins[0].origin)}>
        Remove origin
      </button>
      <button
        type="button"
        onClick={() => onToggleSession(origins[0].origin, true)}
      >
        Toggle session
      </button>
      <button
        type="button"
        onClick={() => onSetPerKindRule(origins[0].origin, 1, "allow")}
      >
        Set kind rule
      </button>
    </div>
  ),
  KeySelectorCard: ({ keys }: { keys: typeof keyManagerMock.keys }) => (
    <div>Key selector: {keys[0]?.label}</div>
  ),
}));

import { ActivityLogTab } from "@/ui/features/settings/components/ActivityLogTab";
import { AdvancedTab } from "@/ui/features/settings/components/AdvancedTab";
import { GeneralSettingsTab } from "@/ui/features/settings/components/GeneralSettingsTab";
import { KeysIdentitiesTab } from "@/ui/features/settings/components/KeysIdentitiesTab";
import { PermissionsTab } from "@/ui/features/settings/components/PermissionsTab";
import { RelaysTab } from "@/ui/features/settings/components/RelaysTab";
import { SecuritySettingsTab } from "@/ui/features/settings/components/SecuritySettingsTab";
import { activityGetRecent } from "@/infrastructure/messaging/client";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function resetSettings() {
  appSettingsMock.settings = {
    __version: "settings.v1",
    theme: "light",
    sidePanel: false,
    autoLockMinutes: 5,
    maxActivityEntries: 50,
    relays: ["wss://relay.example.com"],
    origins: [],
    mediumAllowKinds: [7],
    sessionTTLMinutes: 0,
  };
}

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

function clickByText(container: HTMLElement, text: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text
  );
  expect(element).toBeDefined();

  act(() => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickByTextAsync(container: HTMLElement, text: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text
  );
  expect(element).toBeDefined();

  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  resetSettings();
  appSettingsMock.isLoading = false;
  for (const value of Object.values(appSettingsMock)) {
    if (typeof value === "function") {
      (value as { mockReset?: () => void }).mockReset?.();
    }
  }
  keyManagerMock.selectKey.mockReset();
});

afterEach(() => {
  for (const { root, container } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("options page tab components", () => {
  it("renders General settings and wires theme changes", () => {
    const container = render(<GeneralSettingsTab />);

    expect(container.textContent).toContain("General");
    expect(container.textContent).toContain("Open extension in");

    clickByText(container, "Theme selector: light");

    expect(appSettingsMock.updateTheme).toHaveBeenCalledWith("dark");
  });

  it("does not change a security timeout until the password is confirmed", () => {
    // Both timeouts are password-gated. Moving the slider opens the
    // re-authentication dialog; nothing is written until a password is
    // supplied, and the background refuses the write without one anyway.
    const container = render(<SecuritySettingsTab />);

    clickByText(container, "Auto lock: 5");

    expect(
      appSettingsMock.updateAutoLockMinutes,
      "SECURITY REGRESSION: the auto-lock timeout changed without a password"
    ).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Confirm with your password"
    );
  });

  it("renders Keys & Identities with the key selector", () => {
    const container = render(<KeysIdentitiesTab />);

    expect(container.textContent).toContain("Keys & Identities");
    expect(container.textContent).toContain("Key selector: Main key");
    expect(container.textContent).toContain("Add Key");
  });

  it("renders the Permissions empty state", () => {
    const container = render(<PermissionsTab />);

    expect(container.textContent).toContain("No sites yet");
  });

  it("wires Permissions table actions when origins exist", () => {
    appSettingsMock.settings.origins = [
      {
        origin: "https://primal.net",
        trustLevel: "medium",
        rules: {},
        updatedAt: 1,
      },
    ];
    const container = render(<PermissionsTab />);

    // Removing a policy only ever reduces authority, so it is free.
    clickByText(container, "Remove origin");
    expect(appSettingsMock.removeOriginPolicy).toHaveBeenCalledWith(
      "https://primal.net"
    );

    // Granting a session and setting a kind rule to `allow` are standing
    // permissions to sign without prompting. Both wait for a password.
    clickByText(container, "Toggle session");
    expect(
      appSettingsMock.setSessionGrant,
      "SECURITY REGRESSION: a session grant was created without a password"
    ).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Confirm with your password"
    );

    clickByText(container, "Set kind rule");
    expect(
      appSettingsMock.setPerKindRule,
      "SECURITY REGRESSION: an allow rule was stored without a password"
    ).not.toHaveBeenCalled();
  });

  it("wires Activity Log settings actions", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:ostrilo-activity"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const container = render(<ActivityLogTab />);

    clickByText(container, "Activity entries: 50");
    clickByText(container, "Clear activity");
    await clickByTextAsync(container, "Export activity");

    expect(appSettingsMock.updateMaxActivityEntries).toHaveBeenCalledWith(60);
    expect(appSettingsMock.clearActivityLog).toHaveBeenCalled();
    expect(activityGetRecent).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it("wires relay add and remove actions", () => {
    const container = render(<RelaysTab />);

    clickByText(container, "Add relay");
    clickByText(container, "Remove relay");

    expect(appSettingsMock.addRelay).toHaveBeenCalledWith(
      "wss://new.example.com"
    );
    expect(appSettingsMock.removeRelay).toHaveBeenCalledWith(
      "wss://relay.example.com"
    );
  });

  it("updates medium trust kind defaults from Advanced settings", () => {
    const container = render(<AdvancedTab />);

    clickByText(container, "Medium kind toggles");

    expect(appSettingsMock.updateMediumAllowKinds).toHaveBeenCalledWith([]);
  });

  it.each([
    ["Relays", RelaysTab],
    ["Advanced", AdvancedTab],
    ["Activity Log", ActivityLogTab],
  ] as const)(
    "shows only the loading message on the %s tab while settings load",
    (_name, Tab) => {
      appSettingsMock.isLoading = true;
      const container = render(<Tab />);

      expect(container.textContent).toBe("Loading settings...");
    }
  );

  it("adds a newly enabled kind to the medium trust defaults", () => {
    appSettingsMock.settings.mediumAllowKinds = [];
    const container = render(<AdvancedTab />);

    clickByText(container, "Medium kind toggles");

    expect(appSettingsMock.updateMediumAllowKinds).toHaveBeenCalledWith([7]);
  });

  it("downloads the exported log as JSON and reports success", async () => {
    vi.mocked(activityGetRecent).mockResolvedValueOnce({
      entries: [],
      total: 3,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:ostrilo-activity";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const container = render(<ActivityLogTab />);

    await clickByTextAsync(container, "Export activity");
    await act(async () => {});

    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe("application/json");
    expect(JSON.parse(await blobs[0].text())).toMatchObject({ total: 3, entries: [] });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Activity log exported as a local JSON file."
    );
  });

  describe("exporting a log longer than one RPC page", () => {
    type Stored = {
      id: string;
      origin: string;
      timestamp: number;
      decision: "allow" | "deny";
      reason?: ActivityLogEntry["reason"];
    };
    const stored = (count: number): Stored[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `entry-${index}`,
        origin: "https://site.example",
        timestamp: 1_735_689_600 - index,
        decision: "allow",
      }));

    beforeEach(() => vi.mocked(activityGetRecent).mockClear());
    afterEach(() =>
      vi
        .mocked(activityGetRecent)
        .mockReset()
        .mockResolvedValue({ entries: [], total: 0 })
    );

    // The log as the RPC serves it: newest first, one call capped at 100.
    async function exportWith(
      retention: number,
      logAtCall: (call: number) => Stored[]
    ) {
      appSettingsMock.settings.maxActivityEntries = retention;
      let call = 0;
      vi.mocked(activityGetRecent).mockImplementation(
        async ({ limit = 10, offset = 0 } = {}) => {
          const log = logAtCall(call++);
          return {
            entries: log.slice(offset, offset + Math.min(limit, 100)),
            total: log.length,
          };
        }
      );
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => {}
      );
      const blobs: Blob[] = [];
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: vi.fn((blob: Blob) => {
          blobs.push(blob);
          return "blob:ostrilo-activity";
        }),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: vi.fn(),
      });
      const container = render(<ActivityLogTab />);

      await clickByTextAsync(container, "Export activity");
      await act(async () => {});

      return JSON.parse(await blobs[0].text()) as {
        total: number;
        entries: Array<{ id: string; reason?: string }>;
      };
    }

    it("pages through 250 stored entries when retention is 500", async () => {
      const log = stored(250);
      const exported = await exportWith(500, () => log);

      expect(vi.mocked(activityGetRecent).mock.calls).toEqual([
        [{ limit: 100, offset: 0 }],
        [{ limit: 100, offset: 100 }],
        [{ limit: 100, offset: 200 }],
      ]);
      expect(exported.total).toBe(250);
      expect(exported.entries.map((entry) => entry.id)).toEqual(
        log.map((entry) => entry.id)
      );
    });

    it("stops at the retention limit when more is stored than that", async () => {
      const log = stored(250);
      const exported = await exportWith(150, () => log);

      expect(exported.entries).toHaveLength(150);
      expect(
        vi.mocked(activityGetRecent).mock.calls.map(([args]) => args?.limit)
      ).toEqual([100, 50]);
    });

    it("exports a denial's reason, and leaves out one this build does not recognise", async () => {
      const base = { origin: "https://site.example", timestamp: 1_735_689_600 };
      const log: Stored[] = [
        { ...base, id: "locked", decision: "deny", reason: "vault_locked" },
        { ...base, id: "odd", decision: "deny", reason: "from_the_future" as never },
        { ...base, id: "old", decision: "deny" },
      ];
      const exported = await exportWith(50, () => log);

      expect(exported.entries.map((e) => [e.id, e.reason])).toEqual([
        ["locked", "vault_locked"],
        ["odd", undefined],
        ["old", undefined],
      ]);
    });

    it("exports an entry recorded mid-export once", async () => {
      const log = stored(150);
      const arrival = { ...log[0], id: "arrived-during-export" };
      const exported = await exportWith(500, (call) =>
        call === 0 ? log : [arrival, ...log]
      );

      const ids = exported.entries.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(150);
    });
  });

  it("tells the user when the export fails", async () => {
    vi.mocked(activityGetRecent).mockRejectedValueOnce(new Error("locked"));
    const container = render(<ActivityLogTab />);

    await clickByTextAsync(container, "Export activity");
    await act(async () => {});

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Could not export the activity log. Try again from this page."
    );
  });
});

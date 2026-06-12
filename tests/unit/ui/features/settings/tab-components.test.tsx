/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const appSettingsMock = vi.hoisted(() => ({
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
    isLoading: false,
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

vi.mock("@/components/navigation/open-in-selector", () => ({
  OpenInSelector: () => <div>Open in selector</div>,
}));

vi.mock("@/ui/features/settings/components/shared", () => ({
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

    expect(container.textContent).toContain("General Settings");
    expect(container.textContent).toContain("Open in selector");

    clickByText(container, "Theme selector: light");

    expect(appSettingsMock.updateTheme).toHaveBeenCalledWith("dark");
  });

  it("renders Security controls and wires slider updates", () => {
    const container = render(<SecuritySettingsTab />);

    clickByText(container, "Auto lock: 5");
    clickByText(container, "Session TTL: 0");

    expect(appSettingsMock.updateAutoLockMinutes).toHaveBeenCalledWith(10);
    expect(appSettingsMock.updateSessionTTLMinutes).toHaveBeenCalledWith(30);
  });

  it("renders Keys & Identities with the key selector", () => {
    const container = render(<KeysIdentitiesTab />);

    expect(container.textContent).toContain("Keys & Identities");
    expect(container.textContent).toContain("Key selector: Main key");
    expect(container.textContent).toContain("Add Key");
  });

  it("renders the Permissions empty state", () => {
    const container = render(<PermissionsTab />);

    expect(container.textContent).toContain("No Origins Configured");
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

    clickByText(container, "Remove origin");
    clickByText(container, "Toggle session");
    clickByText(container, "Set kind rule");

    expect(appSettingsMock.removeOriginPolicy).toHaveBeenCalledWith(
      "https://primal.net"
    );
    expect(appSettingsMock.setSessionGrant).toHaveBeenCalledWith(
      "https://primal.net",
      true
    );
    expect(appSettingsMock.setPerKindRule).toHaveBeenCalledWith(
      "https://primal.net",
      1,
      "allow"
    );
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
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { OriginPolicy } from "@/domain/types";
import { flush, render, unmountAll } from "./settings-dom";
import { choose, selectWithOption } from "./settings-native-controls";

interface StubSettings {
  theme: string;
  sidePanel: boolean;
  autoLockMinutes: unknown;
  sessionTTLMinutes: unknown;
  maxActivityEntries?: number;
  relays: string[];
  origins?: OriginPolicy[];
}

const deps = vi.hoisted(() => ({
  isLoading: false,
  settings: {} as StubSettings,
  keys: [] as Array<{ id: string; label: string }>,
  selectedUnlockedKey: undefined as { id: string; label: string } | undefined,
  supported: false,
  updateTheme: vi.fn(),
  updateSidePanel: vi.fn(),
  setIsDocked: vi.fn(),
  dockedKeys: [] as string[],
  enableDocking: vi.fn(),
  disableDocking: vi.fn(),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    settings: deps.settings,
    isLoading: deps.isLoading,
    updateTheme: deps.updateTheme,
    updateSidePanel: deps.updateSidePanel,
  }),
}));

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({
    keys: deps.keys,
    selectedUnlockedKey: deps.selectedUnlockedKey,
  }),
}));

vi.mock("@/hooks/useWxtStorage", () => ({
  useWxtStorage: (key: string) => {
    deps.dockedKeys.push(key);
    return [false, deps.setIsDocked];
  },
}));

vi.mock("@/hooks/useSidePanelDock", () => ({
  useSidePanelDock: () => ({
    supported: deps.supported,
    enableDocking: deps.enableDocking,
    disableDocking: deps.disableDocking,
  }),
}));

vi.mock("@/components/ui/select", async () =>
  (await import("./settings-native-controls")).selectModule
);

import { GeneralSettingsTab } from "@/ui/features/settings/components/GeneralSettingsTab";
import { DOCKED_STORAGE_KEY } from "@/infrastructure/messaging/events";
import { readFileSync } from "node:fs";
import path from "node:path";

function glanceValue(container: HTMLElement, href: string, label: string) {
  const row = Array.from(
    container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)
  ).find((link) => link.textContent?.includes(label));
  expect(row, `no ${href} row for ${label}`).toBeDefined();
  return row!.textContent;
}

beforeEach(() => {
  deps.isLoading = false;
  deps.supported = false;
  deps.settings = {
    theme: "light",
    sidePanel: false,
    autoLockMinutes: 10,
    sessionTTLMinutes: 30,
    maxActivityEntries: 200,
    relays: ["wss://a.example", "wss://b.example"],
    origins: [
      { origin: "https://a.example", trustLevel: "low", rules: {}, updatedAt: 1 },
    ],
  };
  deps.keys = [
    { id: "k1", label: "Main" },
    { id: "k2", label: "Spare" },
  ];
  deps.selectedUnlockedKey = { id: "k1", label: "Main" };
  deps.dockedKeys = [];
  for (const fn of [
    deps.updateTheme,
    deps.updateSidePanel,
    deps.setIsDocked,
    deps.enableDocking,
    deps.disableDocking,
  ]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("GeneralSettingsTab", () => {
  it("shows only the loading message while settings load", () => {
    deps.isLoading = true;
    const container = render(<GeneralSettingsTab />);

    expect(container.textContent).toBe("Loading settings...");
  });

  it("summarises each tab's key value in the at-a-glance list", () => {
    const container = render(<GeneralSettingsTab />);

    expect(glanceValue(container, "#keys", "Main")).toContain("Active key");
    expect(glanceValue(container, "#keys", "Main")).toContain("2 keys");
    expect(glanceValue(container, "#security", "Auto-lock")).toContain("10 min");
    expect(glanceValue(container, "#security", "Session grant")).toContain("30 min");
    expect(glanceValue(container, "#permissions", "Site")).toContain("1 site");
    expect(glanceValue(container, "#relays", "Relays")).toContain("2 relays");
    expect(glanceValue(container, "#activity", "Activity")).toContain(
      "200 entries kept"
    );
  });

  it("falls back to safe summaries for an empty or unset configuration", () => {
    deps.settings = {
      theme: "light",
      sidePanel: false,
      autoLockMinutes: "garbage",
      sessionTTLMinutes: 0,
      relays: ["wss://a.example"],
    };
    deps.keys = [{ id: "k1", label: "Main" }];
    deps.selectedUnlockedKey = undefined;
    const container = render(<GeneralSettingsTab />);

    expect(glanceValue(container, "#keys", "No active key")).toContain(
      "Choose the key that signs"
    );
    expect(glanceValue(container, "#keys", "No active key")).toContain("1 key");
    expect(glanceValue(container, "#security", "Auto-lock")).toContain("5 min");
    expect(glanceValue(container, "#security", "Session grant")).toContain("15 min");
    expect(glanceValue(container, "#permissions", "Site")).toContain("None yet");
    expect(glanceValue(container, "#relays", "Relays")).toContain("1 relay");
    expect(glanceValue(container, "#activity", "Activity")).toContain(
      "50 entries kept"
    );
  });

  it("applies a theme choice", async () => {
    const container = render(<GeneralSettingsTab />);

    await choose(selectWithOption(container, "system"), "system");

    expect(deps.updateTheme).toHaveBeenCalledWith("system");
  });

  it("switches to the side panel with all three writes when the browser supports it", async () => {
    deps.supported = true;
    const container = render(<GeneralSettingsTab />);

    await choose(selectWithOption(container, "sidepanel"), "sidepanel");
    await flush();

    expect(deps.setIsDocked).toHaveBeenCalledWith(true);
    expect(deps.updateSidePanel).toHaveBeenCalledWith(true);
    expect(deps.enableDocking).toHaveBeenCalledWith(true);
    expect(deps.disableDocking).not.toHaveBeenCalled();
  });

  it("switches back to the popup and releases the browser's panel", async () => {
    deps.supported = true;
    deps.settings.sidePanel = true;
    const container = render(<GeneralSettingsTab />);
    expect(selectWithOption(container, "popup").value).toBe("sidepanel");

    await choose(selectWithOption(container, "popup"), "popup");
    await flush();

    expect(deps.setIsDocked).toHaveBeenCalledWith(false);
    expect(deps.updateSidePanel).toHaveBeenCalledWith(false);
    expect(deps.disableDocking).toHaveBeenCalledTimes(1);
  });

  it("holds the chosen mode on screen until the writes settle", async () => {
    let settle: () => void = () => {};
    deps.updateSidePanel.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    const container = render(<GeneralSettingsTab />);
    const select = selectWithOption(container, "sidepanel");

    await choose(select, "sidepanel");

    expect(select.value).toBe("sidepanel");
    expect(container.textContent).toContain(
      "Side panel is not supported in this browser"
    );
    expect(deps.enableDocking).not.toHaveBeenCalled();

    await act(async () => {
      settle();
      await Promise.resolve();
    });
    await flush();

    expect(select.value).toBe("popup");
  });

  it("stores the docked flag under the key the background reapplies on start", () => {
    render(<GeneralSettingsTab />);
    const background = readFileSync(
      path.resolve(__dirname, "../../../../../src/extension/background.ts"),
      "utf8"
    );

    expect(new Set(deps.dockedKeys)).toEqual(new Set([DOCKED_STORAGE_KEY]));
    expect(background).toMatch(/storage\.sync\.get\(DOCKED_STORAGE_KEY\)/);
    expect(background).toMatch(/DOCKED_STORAGE_KEY in changes/);
  });

  it("tells the user when changing where the extension opens fails", async () => {
    deps.updateSidePanel.mockRejectedValueOnce(new Error("quota"));
    const container = render(<GeneralSettingsTab />);
    const select = selectWithOption(container, "sidepanel");

    await choose(select, "sidepanel");
    await flush();

    expect(container.textContent).toContain(
      "Could not change where Ostrilo opens. Try again."
    );
    expect(select.value).toBe("popup");
  });
});

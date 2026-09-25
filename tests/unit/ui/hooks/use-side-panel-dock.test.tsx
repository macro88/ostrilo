// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeSidePanel {
  open?: (options: { windowId: number }) => Promise<void>;
  setOptions?: (options: Record<string, unknown>) => Promise<void>;
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
}

const ext = vi.hoisted(() => ({
  browser: {
    sidePanel: undefined as FakeSidePanel | undefined,
    windows: { getCurrent: vi.fn() },
  },
}));

vi.mock("webextension-polyfill", () => ({ default: ext.browser }));

const { useSidePanelDock } = await import("@/ui/hooks/useSidePanelDock");

type Dock = ReturnType<typeof useSidePanelDock>;

interface PanelState {
  enabled?: boolean;
  path?: string;
  openPanelOnActionClick?: boolean;
  openedInWindow?: number;
}

let panel: PanelState;
let container: HTMLDivElement;
let root: Root;
let current: Dock | null;

function installSidePanel(overrides: Partial<FakeSidePanel> = {}) {
  ext.browser.sidePanel = {
    open: async ({ windowId }) => {
      panel.openedInWindow = windowId;
    },
    setOptions: async (options) => {
      Object.assign(panel, options);
    },
    setPanelBehavior: async ({ openPanelOnActionClick }) => {
      panel.openPanelOnActionClick = openPanelOnActionClick;
    },
    ...overrides,
  };
}

function mount(panelPath?: string): Dock {
  function Harness() {
    current = useSidePanelDock(panelPath);
    return null;
  }
  act(() => root.render(<Harness />));
  if (!current) throw new Error("harness has not rendered");
  return current;
}

describe("useSidePanelDock", () => {
  beforeEach(() => {
    panel = {};
    current = null;
    ext.browser.sidePanel = undefined;
    ext.browser.windows.getCurrent.mockReset();
    ext.browser.windows.getCurrent.mockResolvedValue({ id: 7 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(window, "close").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  describe("without a side panel API", () => {
    it("reports unsupported and makes every action a no-op", async () => {
      const dock = mount();

      expect(dock.supported).toBe(false);
      expect(await dock.open()).toBe(false);
      await dock.enableDocking(true);
      await dock.disableDocking();
      await dock.disablePanel();

      expect(panel).toEqual({});
      expect(window.close).not.toHaveBeenCalled();
    });

    it("treats a partial API without setOptions as unsupported", async () => {
      installSidePanel({ setOptions: undefined });

      expect(mount().supported).toBe(false);
    });
  });

  describe("with a side panel API", () => {
    beforeEach(() => installSidePanel());

    it("enables the panel at its path and opens it in the current window", async () => {
      const dock = mount("sidepanel.html");

      expect(dock.supported).toBe(true);
      expect(await dock.open()).toBe(true);

      expect(panel).toEqual({
        enabled: true,
        path: "sidepanel.html",
        openedInWindow: 7,
      });
    });

    it("enables the panel without overriding the path when none is given", async () => {
      await mount().open();

      expect(panel.enabled).toBe(true);
      expect(panel.path).toBeUndefined();
    });

    it("does not open a panel when the current window has no id", async () => {
      ext.browser.windows.getCurrent.mockResolvedValueOnce({});

      expect(await mount().open()).toBe(true);
      expect(panel.openedInWindow).toBeUndefined();
    });

    it("reports failure when the browser refuses to open the panel", async () => {
      installSidePanel({
        open: async () => {
          throw new Error("must be called in response to a user gesture");
        },
      });

      expect(await mount().open()).toBe(false);
    });

    it("makes the toolbar button open the panel when docking is enabled", async () => {
      await mount().enableDocking();

      expect(panel.openPanelOnActionClick).toBe(true);
      expect(panel.openedInWindow).toBeUndefined();
      expect(window.close).not.toHaveBeenCalled();
    });

    it("opens the panel and closes the popup when docking is enabled immediately", async () => {
      await mount().enableDocking(true);

      expect(panel.openPanelOnActionClick).toBe(true);
      expect(panel.openedInWindow).toBe(7);
      expect(window.close).toHaveBeenCalledTimes(1);
    });

    it("restores the popup and disables the panel when docking is disabled", async () => {
      const dock = mount();
      await dock.enableDocking();

      await dock.disableDocking();

      expect(panel.openPanelOnActionClick).toBe(false);
      expect(panel.enabled).toBe(false);
    });

    it("still disables the panel on a browser without setPanelBehavior", async () => {
      installSidePanel({ setPanelBehavior: undefined });

      await mount().disableDocking();

      expect(panel.enabled).toBe(false);
      expect(panel.openPanelOnActionClick).toBeUndefined();
    });

    it("tolerates setPanelBehavior and setOptions rejecting", async () => {
      installSidePanel({
        setPanelBehavior: async () => {
          throw new Error("unsupported");
        },
        setOptions: async () => {
          throw new Error("unsupported");
        },
      });

      await expect(mount().disableDocking()).resolves.toBeUndefined();
    });
  });
});

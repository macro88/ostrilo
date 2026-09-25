// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS_V1, type AppSettingsV1 } from "@/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.hoisted(() => ({
  getSettings: vi.fn(),
  subscribeSettingsChanged: vi.fn(),
  activityClear: vi.fn(),
}));

vi.mock("@/infrastructure/messaging/client", () => rpc);

type ChangeHandler = (event: MediaQueryListEvent) => void;

const media = {
  matches: false,
  handlers: new Set<ChangeHandler>(),
};

function fakeMediaQueryList(query: string): MediaQueryList {
  return {
    matches: media.matches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, handler: ChangeHandler) => {
      media.handlers.add(handler);
    },
    removeEventListener: (_type: string, handler: ChangeHandler) => {
      media.handlers.delete(handler);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
}

function systemSwitchesTo(dark: boolean) {
  media.matches = dark;
  act(() => {
    for (const handler of media.handlers) {
      handler({ matches: dark } as MediaQueryListEvent);
    }
  });
}

let container: HTMLDivElement;
let root: Root;

async function mountWithTheme(theme: AppSettingsV1["theme"]) {
  rpc.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS_V1, theme });
  const { useTheme } = await import("@/ui/hooks/useTheme");
  function Harness() {
    useTheme();
    return null;
  }
  act(() => root.render(<Harness />));
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

describe("useTheme", () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.getSettings.mockReset();
    media.matches = false;
    media.handlers.clear();
    vi.stubGlobal("matchMedia", vi.fn(fakeMediaQueryList));
    document.documentElement.classList.remove("dark");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("leaves the document alone until settings have loaded", async () => {
    document.documentElement.classList.add("dark");
    rpc.getSettings.mockReturnValue(new Promise(() => undefined));
    const { useTheme } = await import("@/ui/hooks/useTheme");
    function Harness() {
      useTheme();
      return null;
    }

    act(() => root.render(<Harness />));

    expect(isDark()).toBe(true);
  });

  it("applies an explicit dark theme regardless of the system preference", async () => {
    await mountWithTheme("dark");

    expect(isDark()).toBe(true);
    expect(media.handlers.size).toBe(0);
  });

  it("removes the dark class for an explicit light theme", async () => {
    document.documentElement.classList.add("dark");
    media.matches = true;

    await mountWithTheme("light");

    expect(isDark()).toBe(false);
  });

  it("follows the system preference live in system mode", async () => {
    media.matches = true;
    await mountWithTheme("system");
    expect(isDark()).toBe(true);

    systemSwitchesTo(false);
    expect(isDark()).toBe(false);

    systemSwitchesTo(true);
    expect(isDark()).toBe(true);
  });

  it("stops following the system preference once unmounted", async () => {
    await mountWithTheme("system");
    expect(media.handlers.size).toBe(1);

    act(() => root.unmount());
    root = createRoot(container);

    expect(media.handlers.size).toBe(0);
  });
});

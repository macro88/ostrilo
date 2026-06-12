// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROADCAST_EVENTS } from "@/infrastructure/messaging/events";
import { useAppNavigation } from "@/ui/hooks/useAppNavigation";
import type { TabKey } from "@/ui/components/navigation/BottomTabs";

const listeners = new Set<(message: unknown) => void>();

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          listeners.delete(listener);
        }),
      },
    },
  },
}));

function Harness({ onTabChange }: { onTabChange: (tab: TabKey) => void }) {
  const { activeTab } = useAppNavigation("home");

  useEffect(() => {
    onTabChange(activeTab);
  }, [activeTab, onTabChange]);

  return null;
}

describe("useAppNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    listeners.clear();
  });

  it("switches to activity when the switch-to-activity event is broadcast", () => {
    const tabs: TabKey[] = [];

    act(() => {
      root.render(<Harness onTabChange={(tab) => tabs.push(tab)} />);
    });

    expect(tabs).toEqual(["home"]);
    expect(listeners.size).toBe(1);

    act(() => {
      for (const listener of listeners) {
        listener({ __event: BROADCAST_EVENTS.SWITCH_TO_ACTIVITY });
      }
    });

    expect(tabs).toEqual(["home", "activity"]);
  });

  it("ignores unrelated broadcast events", () => {
    const tabs: TabKey[] = [];

    act(() => {
      root.render(<Harness onTabChange={(tab) => tabs.push(tab)} />);
    });

    act(() => {
      for (const listener of listeners) {
        listener({ __event: BROADCAST_EVENTS.QUEUE_UPDATED });
      }
    });

    expect(tabs).toEqual(["home"]);
  });
});

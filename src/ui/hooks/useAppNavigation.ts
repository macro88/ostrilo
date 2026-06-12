import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  BROADCAST_EVENTS,
  type BroadcastEventName,
} from "@/infrastructure/messaging/events";
import type { TabKey } from "@/ui/components/navigation/BottomTabs";

function isBroadcastEvent(
  message: unknown,
  eventName: BroadcastEventName
): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    "__event" in message &&
    (message as { __event?: unknown }).__event === eventName
  );
}

export function useAppNavigation(initialTab: TabKey = "home") {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (isBroadcastEvent(message, BROADCAST_EVENTS.SWITCH_TO_ACTIVITY)) {
        setActiveTab("activity");
      }
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => browser.runtime.onMessage.removeListener(handleMessage);
  }, []);

  return { activeTab, setActiveTab };
}

import { Activity, Home, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKey = "home" | "profile" | "activity" | "settings";

interface BottomTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

const tabs = [
  {
    key: "home" as TabKey,
    label: "Home",
    icon: Home,
  },
  {
    key: "profile" as TabKey,
    label: "Profile",
    icon: User,
  },
  {
    key: "activity" as TabKey,
    label: "Activity",
    icon: Activity,
  },
  {
    key: "settings" as TabKey,
    label: "Settings",
    icon: Settings,
  },
];

/**
 * Four labelled items (DESIGN_RULES §7). Plain buttons rather than the Button
 * primitive: its `[&_svg]:size-4` rule pinned every icon to 16px, which is
 * why the bar read as a row of captions with specks above them.
 */
export function BottomTabs({ activeTab, onTabChange }: BottomTabsProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-full shrink-0 items-stretch justify-around gap-1 border-t border-border bg-card px-2 py-1"
    >
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-12 w-full max-w-24 flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold leading-none transition-colors duration-150",
              isActive
                ? "notch-sm bg-secondary text-secondary-foreground"
                : "rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon
              className="size-[22px] shrink-0"
              strokeWidth={isActive ? 2.25 : 2}
              aria-hidden="true"
            />
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

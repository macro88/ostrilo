import { Home, User, Activity, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function BottomTabs({ activeTab, onTabChange }: BottomTabsProps) {
  return (
    <nav className="flex w-full max-w-full items-center justify-between gap-1 overflow-hidden border-t border-border bg-card/95 p-2 shadow-sm backdrop-blur">
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Button
            key={key}
            variant="ghost"
            onClick={() => onTabChange(key)}
            className={`flex h-auto min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="w-full truncate text-center text-xs font-semibold leading-none">
              {label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}

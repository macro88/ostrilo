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
    <nav className="flex items-center justify-between p-2 bg-background border-t border-border w-full max-w-full overflow-hidden gap-1">
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Button
            key={key}
            variant="ghost"
            onClick={() => onTabChange(key)}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 h-auto py-2 px-1 rounded-lg transition-colors ${
              isActive
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="text-[11px] font-medium leading-none truncate w-full text-center">
              {label}
            </span>
          </Button>
        );
      })}
    </nav>
  );
}

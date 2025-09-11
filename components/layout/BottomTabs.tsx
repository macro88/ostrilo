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
    <nav className="flex items-center justify-around p-2 bg-background border-t border-border">
      {tabs.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Button
            key={key}
            variant="ghost"
            onClick={() => onTabChange(key)}
            className={`flex flex-col items-center gap-1 h-auto py-2 px-4 rounded-lg transition-colors ${
              isActive
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="w-6 h-6" />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        );
      })}
    </nav>
  );
}

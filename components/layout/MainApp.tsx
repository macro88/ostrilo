import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LockScreen } from "@/components/layout/LockScreen";
import { TabKey } from "@/components/layout/BottomTabs";

// Mock views for each tab
function HomeView() {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Total Available</h2>
        <div className="text-3xl font-bold text-primary">$2,968</div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 bg-muted/50 hover:bg-muted text-foreground py-3 px-4 rounded-lg font-medium">
          Deposit
        </button>
        <button className="flex-1 bg-muted/50 hover:bg-muted text-foreground py-3 px-4 rounded-lg font-medium">
          Buy
        </button>
        <button className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-3 px-4 rounded-lg font-medium">
          Send
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Claimable Reward
          </span>
          <button className="bg-primary hover:bg-primary/90 text-primary-foreground px-3 py-1 rounded text-sm font-medium">
            Claim All
          </button>
        </div>
        <div className="text-lg font-semibold">$4.08</div>
      </div>
    </div>
  );
}

function ProfileView() {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Profile</h2>
      <p className="text-muted-foreground">
        Profile management will be implemented here.
      </p>
    </div>
  );
}

function ActivityView() {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Activity</h2>
      <p className="text-muted-foreground">
        Transaction activity will be shown here.
      </p>
    </div>
  );
}

function SettingsView() {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Settings</h2>
      <p className="text-muted-foreground">
        Settings and preferences will be managed here.
      </p>
    </div>
  );
}

interface MainAppProps {
  isUnlocked?: boolean;
}

export function MainApp({ isUnlocked = false }: MainAppProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("home");

  // Show lock screen if not unlocked
  if (!isUnlocked) {
    return <LockScreen />;
  }

  // Mock selected key (would come from actual key management)
  const selectedKey = "npub1234567890abcdef1234567890abcdef1234567890abcdef";

  const renderTabContent = () => {
    switch (activeTab) {
      case "home":
        return <HomeView />;
      case "profile":
        return <ProfileView />;
      case "activity":
        return <ActivityView />;
      case "settings":
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <AppLayout
      selectedKey={selectedKey}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {renderTabContent()}
    </AppLayout>
  );
}

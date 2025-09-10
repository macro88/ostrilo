import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LockScreen } from "@/components/layout/LockScreen";
import { HomeView } from "@/components/layout/HomeView";
import { ProfileView } from "@/components/layout/ProfileView";
import { ActivityView } from "@/components/layout/ActivityView";
import { SettingsView } from "@/components/layout/SettingsView";
import { TabKey } from "@/components/layout/BottomTabs";

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

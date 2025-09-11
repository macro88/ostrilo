import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { LockScreen } from "@/components/layout/LockScreen";
import { OnboardingContainer } from "@/components/onboarding/OnboardingContainer";
import { HomeView } from "@/components/layout/HomeView";
import { ProfileView } from "@/components/layout/ProfileView";
import { ActivityView } from "@/components/layout/ActivityView";
import { SettingsView } from "@/components/layout/SettingsView";
import { TabKey } from "@/components/layout/BottomTabs";
import { useOnboarding } from "@/hooks/useKeyManager";
import { useKeyManager } from "@/hooks/useKeyManager";

export function MainApp() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const { needsOnboarding, needsUnlock } = useOnboarding();
  const { selectedUnlockedKey, isLoading } = useKeyManager();

  // Show onboarding for first-time users
  if (needsOnboarding) {
    return <OnboardingContainer onComplete={() => window.location.reload()} />;
  }

  // Show lock screen if user has keys but needs to unlock
  if (needsUnlock) {
    return (
      <LockScreen
        onUnlock={() => {
          // The unlock happens in the LockScreen component
          // The state will update automatically through the hook
        }}
      />
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

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
      selectedKey={selectedUnlockedKey?.publicKeyBech32 || "No key selected"}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {renderTabContent()}
    </AppLayout>
  );
}

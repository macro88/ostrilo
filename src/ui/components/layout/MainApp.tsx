import { useState } from "react";
import { AppLayout } from "@/ui/components/layout/AppLayout";
import { LockScreen } from "@/ui/components/layout/LockScreen";
import { OnboardingContainer } from "@/ui/components/onboarding/OnboardingContainer";
import { HomeView } from "@/ui/components/layout/HomeView";
import { ProfileView } from "@/ui/components/layout/ProfileView";
import { ActivityView } from "@/ui/components/layout/ActivityView";
import { SettingsView } from "@/ui/components/layout/SettingsView";
import { TabKey } from "@/ui/components/layout/BottomTabs";
import { useOnboarding } from "@/ui/hooks/useOnboarding";
import { useKeyManager } from "@/ui/hooks/useKeyManager";

export function MainApp() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const { needsOnboarding } = useOnboarding();
  const { selectedUnlockedKey, isLoading, isLocked } = useKeyManager();

  // Show onboarding for first-time users
  if (needsOnboarding) {
    return <OnboardingContainer onComplete={() => window.location.reload()} />;
  }

  // Show lock screen if user has keys but needs to unlock
  if (isLocked) {
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

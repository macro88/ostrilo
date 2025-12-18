import { useState } from "react";
import { AppLayout } from "@/ui/components/layout/AppLayout";
import { LockScreen } from "@/ui/features/authentication/components/LockScreen";
import { OnboardingContainer } from "@/ui/features/onboarding/components/OnboardingContainer";
import { HomeView } from "@/ui/features/home/components/HomeView";
import { ProfileView } from "@/ui/features/profile/components/ProfileView";
import { ActivityView } from "@/ui/features/activity/components/ActivityView";
import { BasicSettings } from "@/ui/features/settings/components/BasicSettings";
import { TabKey } from "@/ui/components/navigation/BottomTabs";
import { useOnboarding } from "@/ui/features/onboarding/hooks/useOnboarding";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { AddKeyDialog } from "@/ui/components/dialogs/AddKeyDialog";

export function MainApp() {
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [isAddKeyDialogOpen, setIsAddKeyDialogOpen] = useState(false);
  const { needsOnboarding } = useOnboarding();
  const { selectedUnlockedKey, isLoading, isLocked, refreshKeys } =
    useKeyManager();

  const handleAddKey = () => {
    setIsAddKeyDialogOpen(true);
  };

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
        return <BasicSettings />;
      default:
        return <HomeView />;
    }
  };

  return (
    <>
      <AppLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddKey={handleAddKey}
      >
        {renderTabContent()}
      </AppLayout>

      <AddKeyDialog
        isOpen={isAddKeyDialogOpen}
        onClose={() => setIsAddKeyDialogOpen(false)}
        onSuccess={refreshKeys}
      />
    </>
  );
}

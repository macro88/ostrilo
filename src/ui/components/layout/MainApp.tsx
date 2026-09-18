import { useState } from "react";
import { AppLayout } from "@/ui/components/layout/AppLayout";
import { LockScreen } from "@/ui/features/authentication/components/LockScreen";
import { OnboardingContainer } from "@/ui/features/onboarding/components/OnboardingContainer";
import { HomeView } from "@/ui/features/home/components/HomeView";
import { ProfileView } from "@/ui/features/profile/components/ProfileView";
import { ActivityView } from "@/ui/features/activity/components/ActivityView";
import { BasicSettings } from "@/ui/features/settings/components/BasicSettings";
import { useOnboarding } from "@/ui/features/onboarding/hooks/useOnboarding";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { AddKeyDialog } from "@/ui/components/dialogs/AddKeyDialog";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";
import { useAppNavigation } from "@/ui/hooks/useAppNavigation";

export function MainApp() {
  const { activeTab, setActiveTab } = useAppNavigation("home");
  const [isAddKeyDialogOpen, setIsAddKeyDialogOpen] = useState(false);
  const { needsOnboarding } = useOnboarding();
  const { isLoading, isLocked, refreshKeys } =
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
      <div className="app-canvas flex min-h-screen items-center justify-center">
        <LoadingSpinner label="Opening Ostrilo..." />
      </div>
    );
  }

  const tabContent =
    activeTab === "profile" ? (
      <ProfileView />
    ) : activeTab === "activity" ? (
      <ActivityView />
    ) : activeTab === "settings" ? (
      <BasicSettings />
    ) : (
      <HomeView onNavigate={setActiveTab} />
    );

  return (
    <>
      <AppLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddKey={handleAddKey}
      >
        {tabContent}
      </AppLayout>

      <AddKeyDialog
        isOpen={isAddKeyDialogOpen}
        onClose={() => setIsAddKeyDialogOpen(false)}
        onSuccess={refreshKeys}
      />
    </>
  );
}

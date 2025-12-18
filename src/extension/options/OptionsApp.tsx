import { useState, useEffect } from "react";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsTab } from "@/ui/features/settings/components/GeneralSettingsTab";
import { KeysIdentitiesTab } from "@/ui/features/settings/components/KeysIdentitiesTab";
import { SecuritySettingsTab } from "@/ui/features/settings/components/SecuritySettingsTab";
import { PermissionsTab } from "@/ui/features/settings/components/PermissionsTab";
import { ActivityLogTab } from "@/ui/features/settings/components/ActivityLogTab";
import { RelaysTab } from "@/ui/features/settings/components/RelaysTab";
import { AdvancedTab } from "@/ui/features/settings/components/AdvancedTab";

const TABS = [
  "general",
  "keys",
  "security",
  "permissions",
  "activity",
  "relays",
  "advanced",
] as const;

export function OptionsApp() {
  const [activeTab, setActiveTab] = useState("general");

  // Handle URL hash navigation
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && TABS.includes(hash as any)) {
      setActiveTab(hash);
    }

    const handleHashChange = () => {
      const newHash = window.location.hash.slice(1);
      if (newHash && TABS.includes(newHash as any)) {
        setActiveTab(newHash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Update URL hash when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const currentIndex = TABS.indexOf(activeTab as any);
      
      if (e.key === "ArrowRight" && currentIndex < TABS.length - 1) {
        handleTabChange(TABS[currentIndex + 1]);
      } else if (e.key === "ArrowLeft" && currentIndex > 0) {
        handleTabChange(TABS[currentIndex - 1]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab]);

  // Cross-context settings sync - listen for changes from popup/sidepanel
  // Note: useAppSettings hook already handles storage changes internally via useWxtStorage
  // No need for explicit listener here - settings components will re-render automatically

  return (
    <KeyManagerProvider>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Ostrilo Settings</h1>
                <p className="text-sm text-muted-foreground">
                  Configure your Nostr signer
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                v1.0.0
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-6 py-6">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="mb-6">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="keys">Keys & Identities</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="activity">Activity Log</TabsTrigger>
              <TabsTrigger value="relays">Relays</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <GeneralSettingsTab />
            </TabsContent>

            <TabsContent value="keys">
              <KeysIdentitiesTab />
            </TabsContent>

            <TabsContent value="security">
              <SecuritySettingsTab />
            </TabsContent>

            <TabsContent value="permissions">
              <PermissionsTab />
            </TabsContent>

            <TabsContent value="activity">
              <ActivityLogTab />
            </TabsContent>

            <TabsContent value="relays">
              <RelaysTab />
            </TabsContent>

            <TabsContent value="advanced">
              <AdvancedTab />
            </TabsContent>
          </Tabs>
        </main>

        {/* Footer */}
        <footer className="border-t border-border bg-card mt-12">
          <div className="max-w-5xl mx-auto px-6 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Settings are automatically saved
            </p>
          </div>
        </footer>
      </div>
    </KeyManagerProvider>
  );
}

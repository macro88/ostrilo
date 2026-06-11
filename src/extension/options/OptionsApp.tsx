import { useState, useEffect } from "react";
import { KeyManagerProvider } from "@/ui/state/KeyManagerContext";
import { useTheme } from "@/ui/hooks/useTheme";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralSettingsTab } from "@/ui/features/settings/components/GeneralSettingsTab";
import { KeysIdentitiesTab } from "@/ui/features/settings/components/KeysIdentitiesTab";
import { SecuritySettingsTab } from "@/ui/features/settings/components/SecuritySettingsTab";
import { PermissionsTab } from "@/ui/features/settings/components/PermissionsTab";
import { ActivityLogTab } from "@/ui/features/settings/components/ActivityLogTab";
import { RelaysTab } from "@/ui/features/settings/components/RelaysTab";
import { AdvancedTab } from "@/ui/features/settings/components/AdvancedTab";
import { Logo } from "@/ui/components/logo/Logo";

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
  // Apply theme based on settings and system preference
  useTheme();

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
      <div className="app-canvas flex min-h-screen flex-col bg-background">
        <header className="border-b border-border bg-card/95 shadow-sm backdrop-blur">
          <div className="options-container py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent p-1.5 shadow-sm">
                  <Logo size="lg" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold leading-tight">
                    Ostrilo Settings
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Configure your local Nostr signer
                  </p>
                </div>
              </div>
              <div className="stamp-chip">
                v1.0.0
              </div>
            </div>
          </div>
        </header>

        <main className="mt-4 flex-1">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="border-y border-border bg-card/85">
              <div className="options-container">
                <TabsList className="options-tabs flex min-h-12 w-full flex-wrap justify-start gap-1 overflow-x-auto bg-transparent p-2">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="keys">Keys & Identities</TabsTrigger>
                  <TabsTrigger value="security">Security</TabsTrigger>
                  <TabsTrigger value="permissions">Permissions</TabsTrigger>
                  <TabsTrigger value="activity">Activity Log</TabsTrigger>
                  <TabsTrigger value="relays">Relays</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <div className="options-container py-6">
              <TabsContent value="general" className="tab-content">
                <GeneralSettingsTab />
              </TabsContent>

              <TabsContent value="keys" className="tab-content">
                <KeysIdentitiesTab />
              </TabsContent>

              <TabsContent value="security" className="tab-content">
                <SecuritySettingsTab />
              </TabsContent>

              <TabsContent value="permissions" className="tab-content">
                <PermissionsTab />
              </TabsContent>

              <TabsContent value="activity" className="tab-content">
                <ActivityLogTab />
              </TabsContent>

              <TabsContent value="relays" className="tab-content">
                <RelaysTab />
              </TabsContent>

              <TabsContent value="advanced" className="tab-content">
                <AdvancedTab />
              </TabsContent>
            </div>
          </Tabs>
        </main>

        <footer className="mt-auto mb-8 bg-transparent">
          <div className="options-container py-4">
            <p className="text-sm text-muted-foreground text-center">
              Settings are automatically saved
            </p>
          </div>
        </footer>
      </div>
    </KeyManagerProvider>
  );
}

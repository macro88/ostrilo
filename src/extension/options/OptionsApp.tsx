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
import {
  Activity,
  Key,
  Radio,
  Settings,
  Shield,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";

const TABS = [
  { key: "general", label: "General", icon: Settings },
  { key: "keys", label: "Keys & Identities", icon: Key },
  { key: "security", label: "Security", icon: Shield },
  { key: "permissions", label: "Permissions", icon: SlidersHorizontal },
  { key: "activity", label: "Activity Log", icon: Activity },
  { key: "relays", label: "Relays", icon: Radio },
  { key: "advanced", label: "Advanced", icon: Wrench },
] as const;

const TAB_KEYS = TABS.map((tab) => tab.key);

function getHashTab() {
  const hash = window.location.hash.slice(1);
  return TAB_KEYS.includes(hash as any) ? hash : "general";
}

export function OptionsApp() {
  // Apply theme based on settings and system preference
  useTheme();

  const [activeTab, setActiveTab] = useState(getHashTab);

  // Handle URL hash navigation
  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getHashTab());
    };

    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  // Update URL hash when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.history.pushState(null, "", `#${tab}`);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const currentIndex = TAB_KEYS.indexOf(activeTab as any);
      
      if ((e.key === "ArrowRight" || e.key === "ArrowDown") && currentIndex < TAB_KEYS.length - 1) {
        handleTabChange(TAB_KEYS[currentIndex + 1]);
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && currentIndex > 0) {
        handleTabChange(TAB_KEYS[currentIndex - 1]);
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
        <header className="border-b border-border bg-card">
          <div className="options-container py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Logo size="lg" />
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold leading-tight">
                    Ostrilo Settings
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Configure your local Nostr signer
                  </p>
                </div>
              </div>
              <div className="seal-chip seal-chip-accent">
                v1.0.0
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="options-container grid gap-6 py-6 lg:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="lg:sticky lg:top-6 lg:self-start">
                <TabsList className="options-tabs ink-card flex w-full flex-row justify-start gap-1 overflow-x-auto p-2 lg:flex-col lg:items-stretch lg:overflow-visible">
                  {TABS.map(({ key, label, icon: Icon }) => (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="justify-start gap-2 lg:w-full lg:flex-none"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </aside>

              <div className="min-w-0">
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

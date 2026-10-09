import { useCallback, useEffect, useState } from "react";
import {
  KeyManagerProvider,
  useKeyManagerContext,
} from "@/ui/state/KeyManagerContext";
import { LockScreen } from "@/ui/features/authentication/components/LockScreen";
import { BackgroundUnreachable } from "@/ui/features/authentication/components/BackgroundUnreachable";
import { useTheme } from "@/ui/hooks/useTheme";
import { BACKUP_HASH_PARAM } from "@/ui/lib/open-options";
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

type TabKey = (typeof TABS)[number]["key"];

const TAB_KEYS: readonly TabKey[] = TABS.map((tab) => tab.key);

function isTabKey(value: string): value is TabKey {
  return (TAB_KEYS as readonly string[]).includes(value);
}

/** The hash is `#tab`, optionally `#tab?param=value`. */
function splitHash(): { tab: string; params: URLSearchParams } {
  const [tab, query = ""] = window.location.hash.slice(1).split("?");
  return { tab, params: new URLSearchParams(query) };
}

function getHashTab(): TabKey {
  const { tab } = splitHash();
  return isTabKey(tab) ? tab : "general";
}

/** The key the Home banner asked to back up, when the page was opened for it. */
function getHashBackupKeyId(): string | null {
  const { tab, params } = splitHash();
  return tab === "keys" ? params.get(BACKUP_HASH_PARAM) : null;
}

/**
 * Lock gate for the options page.
 *
 * The popup renders LockScreen when locked; this page had NO lock check at all.
 * With the vault locked it exposed every key label and pubkey, every origin
 * policy (a record of which Nostr sites the user uses), the relay list, and the
 * activity log with content previews of everything signed - and it permitted
 * mutation. The chain that made it serious: brief access to a locked browser,
 * open options, set an origin to high trust, walk away; the next time the user
 * unlocks, that site signs silently and no prompt ever appears.
 *
 * Note this is defence in depth for the UI only. The authoritative check is in
 * the RPC handlers: a UI gate is a gate an attacker skips by sending the
 * message directly.
 */
function OptionsGate({ children }: { children: React.ReactNode }) {
  const {
    isLocked,
    isInitialising,
    hasKeys,
    lockCheckFailed,
    retryLockCheck,
    isLoading,
  } = useKeyManagerContext();

  // `isInitialising`, NOT `isLoading`. `isLoading` is also true for the
  // duration of an unlock attempt, so gating on it unmounted the lock screen
  // the moment the user pressed Unlock and remounted it afterwards with fresh
  // state - discarding the failure message the screen had just been given.
  // This gate only exists to avoid flashing the wrong branch before the first
  // lock-state read resolves.
  if (isInitialising) return null;

  // Ahead of the no-keys notice: a silent background also yields no keys.
  if (lockCheckFailed) {
    return (
      <BackgroundUnreachable
        onRetry={retryLockCheck}
        isRetrying={isLoading}
      />
    );
  }

  // No vault yet: nothing to lock, and nothing to show.
  if (!hasKeys) {
    return (
      <div className="options-shell py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Create a key in the Ostrilo popup before opening settings.
        </p>
      </div>
    );
  }

  if (isLocked) {
    return <LockScreen onUnlock={() => undefined} />;
  }

  return <>{children}</>;
}

export function OptionsApp() {
  // Apply theme based on settings and system preference
  useTheme();

  const [activeTab, setActiveTab] = useState<TabKey>(getHashTab);
  // Read once, at load. Cleared from the address once Keys & Identities has
  // acted on it, so reloading the page does not open the backup a second time.
  const [backupKeyId, setBackupKeyId] = useState(getHashBackupKeyId);

  const handleBackupRequestHandled = useCallback(() => {
    setBackupKeyId(null);
    window.history.replaceState(null, "", "#keys");
  }, []);

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
  const handleTabChange = useCallback((tab: string) => {
    if (!isTabKey(tab)) return;
    setActiveTab(tab);
    window.history.pushState(null, "", `#${tab}`);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Widgets that own the arrow keys themselves. Excluding only <input> and
      // <textarea> was not enough: a Radix slider thumb is a `<span
      // role="slider">`, so every arrow press on the auto-lock and session
      // timeout sliders was swallowed by this handler and switched tab
      // instead. Those two controls decide how long an unlocked vault stays
      // open, and neither could be operated from the keyboard at all.
      if (
        e.target instanceof Element &&
        e.target.closest(
          '[role="slider"], [role="listbox"], [role="combobox"], [role="menu"], [role="radiogroup"], [role="spinbutton"], select, [contenteditable]'
        )
      ) {
        return;
      }

      const currentIndex = TAB_KEYS.indexOf(activeTab);

      if ((e.key === "ArrowRight" || e.key === "ArrowDown") && currentIndex < TAB_KEYS.length - 1) {
        handleTabChange(TAB_KEYS[currentIndex + 1]);
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && currentIndex > 0) {
        handleTabChange(TAB_KEYS[currentIndex - 1]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, handleTabChange]);

  // Cross-context settings sync: useAppSettings already re-reads on the
  // background's settings-changed notification, so every tab re-renders when
  // the popup or side panel changes a setting. No listener needed here.

  return (
    <KeyManagerProvider>
      <OptionsGate>
        <div className="app-canvas flex min-h-screen flex-col bg-background">
          {/* A 24px static mark beside the wordmark (DESIGN_RULES §9); the
              version lives under Advanced > About, not up here. */}
          <header className="options-header">
            <div className="options-shell flex items-center gap-3">
              <Logo size="sm" />
              <h1 className="text-[17px] font-bold leading-none tracking-[-0.01em]">
                Ostrilo Settings
              </h1>
            </div>
          </header>

          <main className="flex-1">
            <Tabs
              value={activeTab}
              onValueChange={handleTabChange}
              className="options-shell options-layout"
            >
              <TabsList aria-label="Settings sections" className="options-nav">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <TabsTrigger key={key} value={key} className="justify-start">
                    <Icon aria-hidden="true" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="options-panel">
                <TabsContent value="general">
                  <GeneralSettingsTab />
                </TabsContent>

                <TabsContent value="keys">
                  <KeysIdentitiesTab
                    backupRequestKeyId={backupKeyId}
                    onBackupRequestHandled={handleBackupRequestHandled}
                  />
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
              </div>
            </Tabs>
          </main>
        </div>
      </OptionsGate>
    </KeyManagerProvider>
  );
}

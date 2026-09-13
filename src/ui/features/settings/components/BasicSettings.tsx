import { Button } from "@/components/ui/button";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";
import { Key, Settings as SettingsIcon } from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";
import {
  ThemeSelector,
  AutoLockSlider,
} from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";

function openOptionsPage() {
  // Type assertions for browser extension APIs
  const browserAPI = (globalThis as any).browser || (globalThis as any).chrome;
  if (browserAPI?.runtime?.openOptionsPage) {
    browserAPI.runtime.openOptionsPage();
  }
}

export function BasicSettings() {
  const { settings, isLoading, updateTheme, updateAutoLockMinutes } =
    useAppSettings();
  const reauth = useReauth();

  // Same gate as the Security tab. The popup is the surface most likely to
  // be open on an unattended screen, so it is the one that most needs it.
  const changeAutoLock = async (minutes: number) => {
    try {
      await reauth.request(
        {
          action: `Change the auto-lock timeout to ${minutes} minutes.`,
          consequence: "This controls how long an unattended vault stays open.",
        },
        (password) => updateAutoLockMinutes(minutes, password)
      );
    } catch {
      // Cancelled.
    }
  };
  const { selectedUnlockedKey } = useKeyManager();

  // Note: useAppSettings hook already handles storage changes internally via useWxtStorage
  // Settings components will re-render automatically when values change

  if (isLoading) {
    return (
      <div className="screen-shell">
        <div className="ink-card p-4 text-center">
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-shell">
      <div className="screen-header text-center">
        <h2 className="screen-title">Settings</h2>
        <p className="screen-description">Quick controls for this signer window.</p>
      </div>

      <div className="ink-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
            <Key className="h-4 w-4" />
          </div>
          <h3 className="font-medium">Active Key</h3>
        </div>
        {selectedUnlockedKey ? (
          <div className="space-y-2">
            <Pubkey
              key={selectedUnlockedKey.id}
              label={selectedUnlockedKey.label}
              pubkey={selectedUnlockedKey.publicKeyBech32}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No key selected</p>
        )}
      </div>

      <div className="ink-card p-4">
        <ThemeSelector value={settings.theme} onChange={updateTheme} />
      </div>

      <div className="ink-card p-4">
        <AutoLockSlider
          value={settings.autoLockMinutes}
          onChange={changeAutoLock}
        />
        <ReauthDialog {...reauth.dialogProps} />
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={openOptionsPage}
      >
        <SettingsIcon className="h-4 w-4 mr-2" />
        Advanced Settings
      </Button>
    </div>
  );
}

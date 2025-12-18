import { Button } from "@/components/ui/button";
import { Key, Settings as SettingsIcon } from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";
import {
  ThemeSelector,
  AutoLockSlider,
} from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";

export function BasicSettings() {
  const { settings, isLoading, updateTheme, updateAutoLockMinutes } =
    useAppSettings();
  const { selectedUnlockedKey } = useKeyManager();

  const handleOpenOptions = () => {
    // Type assertions for browser extension APIs
    const browserAPI = (globalThis as any).browser || (globalThis as any).chrome;
    if (browserAPI?.runtime?.openOptionsPage) {
      browserAPI.runtime.openOptionsPage();
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <div className="text-center mb-4">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-muted-foreground">Quick settings access</p>
      </div>

      {/* Current Key Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Key className="h-4 w-4" />
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

      {/* Theme Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <ThemeSelector value={settings.theme} onChange={updateTheme} />
      </div>

      {/* Auto-lock Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <AutoLockSlider
          value={settings.autoLockMinutes}
          onChange={updateAutoLockMinutes}
        />
      </div>

      {/* Advanced Settings Button */}
      <Button
        variant="outline"
        className="w-full"
        onClick={handleOpenOptions}
      >
        <SettingsIcon className="h-4 w-4 mr-2" />
        Advanced Settings
      </Button>
    </div>
  );
}

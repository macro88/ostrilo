import { useAppSettings } from "@/hooks/useAppSettings";
import { useKeyManager } from "@/hooks/useKeyManager";
import { Key, Settings, Shield, Globe } from "lucide-react";

export function HomeView() {
  const { settings, isLoading: settingsLoading } = useAppSettings();
  const {
    hasKeys,
    selectedUnlockedKey,
    isLoading: keysLoading,
    generateKey,
  } = useKeyManager();

  const isLoading = settingsLoading || keysLoading;

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Ostrilo Signer</h2>
        <p className="text-muted-foreground">Your Nostr identity manager</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Keys</span>
          </div>
          <p className="text-lg font-semibold">{hasKeys ? "1+" : "0"}</p>
          <p className="text-xs text-muted-foreground">
            {selectedUnlockedKey ? "1 active" : "None selected"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Security</span>
          </div>
          <p className="text-lg font-semibold">
            {settings.autoLockMinutes === 0
              ? "∞"
              : `${settings.autoLockMinutes}m`}
          </p>
          <p className="text-xs text-muted-foreground">Auto-lock</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Relays</span>
          </div>
          <p className="text-lg font-semibold">{settings.relays.length}</p>
          <p className="text-xs text-muted-foreground">Configured</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Origins</span>
          </div>
          <p className="text-lg font-semibold">{settings.origins.length}</p>
          <p className="text-xs text-muted-foreground">Trusted</p>
        </div>
      </div>

      {/* Current Settings Summary */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-medium mb-3">Current Settings</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Theme:</span>
            <span className="capitalize">{settings.theme}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Side Panel:</span>
            <span>{settings.sidePanel ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Session TTL:</span>
            <span>
              {settings.sessionTTLMinutes === 0
                ? "Until lock"
                : `${settings.sessionTTLMinutes}m`}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Medium trust kinds:</span>
            <span>{settings.mediumAllowKinds.length} allowed</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-medium mb-3">Quick Actions</h3>
        <div className="space-y-2">
          <button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 px-4 rounded-lg font-medium"
            onClick={() => generateKey("", "New Key")}
          >
            Generate New Key
          </button>
          <button
            className="w-full bg-muted hover:bg-muted/80 text-foreground py-2 px-4 rounded-lg font-medium"
            disabled
          >
            Import Key
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Key management features coming soon
        </p>
      </div>
    </div>
  );
}

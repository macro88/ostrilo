import { useAppSettings } from "@/hooks/useAppSettings";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
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
    <div className="h-full overflow-y-auto p-3 space-y-3 max-w-full">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-1">Ostrilo Signer</h2>
        <p className="text-muted-foreground text-sm">
          Your Nostr identity manager
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-2 w-full max-w-full">
        <div className="bg-card border border-border rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Key className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">Keys</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {hasKeys ? "1+" : "0"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {selectedUnlockedKey ? "1 active" : "None selected"}
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">Security</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.autoLockMinutes === 0
              ? "∞"
              : `${settings.autoLockMinutes}m`}
          </p>
          <p className="text-xs text-muted-foreground truncate">Auto-lock</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">Relays</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.relays.length}
          </p>
          <p className="text-xs text-muted-foreground truncate">Configured</p>
        </div>

        <div className="bg-card border border-border rounded-lg p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">Origins</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.origins.length}
          </p>
          <p className="text-xs text-muted-foreground truncate">Trusted</p>
        </div>
      </div>

      {/* Current Settings Summary */}
      <div className="bg-card border border-border rounded-lg p-3 w-full max-w-full">
        <h3 className="font-medium mb-2 text-sm">Current Settings</h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground truncate">Theme:</span>
            <span className="capitalize truncate">{settings.theme}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground truncate">Side Panel:</span>
            <span className="truncate">
              {settings.sidePanel ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground truncate">Session TTL:</span>
            <span className="truncate">
              {settings.sessionTTLMinutes === 0
                ? "Until lock"
                : `${settings.sessionTTLMinutes}m`}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground truncate">
              Medium trust kinds:
            </span>
            <span className="truncate">
              {settings.mediumAllowKinds.length} allowed
            </span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-card border border-border rounded-lg p-3 w-full max-w-full">
        <h3 className="font-medium mb-3">Quick Actions</h3>
        <div className="space-y-2">
          <button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 px-3 rounded-lg font-medium"
            onClick={() => generateKey("", "New Key")}
          >
            Generate New Key
          </button>
          <button
            className="w-full bg-muted hover:bg-muted/80 text-foreground py-2 px-3 rounded-lg font-medium"
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

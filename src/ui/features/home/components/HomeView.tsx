import { useAppSettings } from "@/hooks/useAppSettings";
import { useKeyManager } from "../../authentication/hooks/useKeyManager";
import { Button } from "@/components/ui/button";
import { Key, Settings, Shield, Globe, Sparkles } from "lucide-react";

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
      <div className="screen-shell">
        <div className="plush-card text-center">
          <p className="text-sm text-muted-foreground">Loading home...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-shell">
      <div className="screen-header">
        <div className="flex items-start gap-3">
          <div className="icon-bubble">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="screen-title">Local signing, zero snooping</h2>
            <p className="screen-description">
              Review identities, relays, and trusted origins before a site gets a stamp.
            </p>
          </div>
        </div>
      </div>

      <div className="grid w-full max-w-full grid-cols-2 gap-3">
        <div className="metric-card">
          <div className="mb-2 flex items-center gap-2">
            <div className="icon-bubble h-7 w-7">
              <Key className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium truncate">Keys</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {hasKeys ? "1+" : "0"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {selectedUnlockedKey ? "1 active" : "None selected"}
          </p>
        </div>

        <div className="metric-card">
          <div className="mb-2 flex items-center gap-2">
            <div className="icon-bubble h-7 w-7">
              <Shield className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium truncate">Security</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.autoLockMinutes === 0
              ? "∞"
              : `${settings.autoLockMinutes}m`}
          </p>
          <p className="text-xs text-muted-foreground truncate">Auto-lock</p>
        </div>

        <div className="metric-card">
          <div className="mb-2 flex items-center gap-2">
            <div className="icon-bubble h-7 w-7">
              <Globe className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium truncate">Relays</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.relays.length}
          </p>
          <p className="text-xs text-muted-foreground truncate">Configured</p>
        </div>

        <div className="metric-card">
          <div className="mb-2 flex items-center gap-2">
            <div className="icon-bubble h-7 w-7">
              <Settings className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium truncate">Origins</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {settings.origins.length}
          </p>
          <p className="text-xs text-muted-foreground truncate">Trusted</p>
        </div>
      </div>

      <div className="plush-card w-full max-w-full">
        <h3 className="mb-3 text-sm font-semibold">Current Settings</h3>
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

      <div className="plush-card w-full max-w-full">
        <h3 className="mb-3 text-sm font-semibold">Quick Actions</h3>
        <div className="space-y-2">
          <Button
            className="btn-plush w-full"
            onClick={() => generateKey("", "New Key")}
          >
            Generate New Key
          </Button>
          <Button
            variant="outline"
            className="w-full"
            disabled
          >
            Import Key
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Key management features coming soon
        </p>
      </div>
    </div>
  );
}

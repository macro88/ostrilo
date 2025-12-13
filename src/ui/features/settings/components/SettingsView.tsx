import { useState } from "react";
import { SidePanelToggle } from "@/components/navigation/sidepanel-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useAppSettings } from "@/hooks/useAppSettings";
import {
  Theme,
  TrustLevel,
  TRUST_LEVEL_DESCRIPTIONS,
  COMMON_EVENT_KINDS,
} from "@/domain/types";
import {
  Plus,
  X,
  Key,
  Shield,
  Clock,
  Globe,
  Trash2,
  Computer,
  Fingerprint,
} from "lucide-react";
import { Pubkey } from "@/components/common/pubkey";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";

export function SettingsView() {
  const {
    settings,
    isLoading,
    updateTheme,
    updateAutoLockMinutes,
    updateSessionTTLMinutes,
    addRelay,
    removeRelay,
    updateMediumAllowKinds,
    resetSettings,
    setPerKindRule,
    setSessionGrant,
    removeOriginPolicy,
  } = useAppSettings();
  const { selectedUnlockedKey } = useKeyManager();
  const [newRelay, setNewRelay] = useState("");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  useState(() => {
    // Check if biometric authentication is available
    if ("credentials" in navigator && "create" in navigator.credentials) {
      setBiometricAvailable(true);
    }
  });

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  const handleAddRelay = () => {
    if (newRelay.trim() && newRelay.startsWith("wss://")) {
      addRelay(newRelay.trim());
      setNewRelay("");
    }
  };

  const handleThemeChange = (value: string) => {
    updateTheme(value as Theme);
  };

  const handleAutoLockChange = (value: number[]) => {
    updateAutoLockMinutes(value[0]);
  };

  const handleSessionTTLChange = (value: number[]) => {
    updateSessionTTLMinutes(value[0]);
  };

  const handleToggleMediumKind = (kind: number, enabled: boolean) => {
    const currentKinds = settings.mediumAllowKinds;
    if (enabled && !currentKinds.includes(kind)) {
      updateMediumAllowKinds([...currentKinds, kind]);
    } else if (!enabled && currentKinds.includes(kind)) {
      updateMediumAllowKinds(currentKinds.filter((k) => k !== kind));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <div className="text-center mb-4">
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-muted-foreground">Configure your signer</p>
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
        <div className="flex items-center gap-2 mb-4">
          <Computer className="h-4 w-4" />
          <h3 className="font-medium">Display</h3>
        </div>
        <div className="space-y-3">
          <Label htmlFor="theme">Theme</Label>
          <Select value={settings.theme} onValueChange={handleThemeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SidePanelToggle />
      </div>

      {/* Security Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4" />
          <h3 className="font-medium">Security</h3>
        </div>

        {biometricAvailable && (
          <div className="flex items-center space-x-2 p-3 border rounded-lg">
            <Fingerprint className="h-5 w-5 text-blue-500" />
            <div className="flex-1">
              <div className="font-medium">Enable Biometric Unlock</div>
              <div className="text-sm text-muted-foreground">
                Use fingerprint or face recognition for quick access
              </div>
            </div>
            <input
              type="checkbox"
              checked={biometricEnabled}
              onChange={(e) => setBiometricEnabled(e.target.checked)}
              className="rounded"
            />
          </div>
        )}

        <div className="space-y-4">
          {/* Auto-lock timer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Auto-lock after inactivity</Label>
              <span className="text-sm text-muted-foreground">
                {settings.autoLockMinutes === 0
                  ? "Never"
                  : `${settings.autoLockMinutes} min`}
              </span>
            </div>
            <Slider
              value={[settings.autoLockMinutes]}
              onValueChange={handleAutoLockChange}
              max={60}
              min={0}
              step={5}
              className="w-full"
            />
          </div>

          {/* Session TTL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Session grant timeout</Label>
              <span className="text-sm text-muted-foreground">
                {settings.sessionTTLMinutes === 0
                  ? "Until lock"
                  : `${settings.sessionTTLMinutes} min`}
              </span>
            </div>
            <Slider
              value={[settings.sessionTTLMinutes]}
              onValueChange={handleSessionTTLChange}
              max={120}
              min={0}
              step={15}
              className="w-full"
            />
          </div>

          {/* Action buttons */}
          <div className="space-y-2 pt-2">
            <Button variant="outline" className="w-full text-left" disabled>
              Change Password
            </Button>
            <Button variant="outline" className="w-full text-left" disabled>
              Export Private Key
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                if (
                  confirm(
                    "This will reset all settings to defaults. Are you sure?"
                  )
                ) {
                  resetSettings();
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Reset All Settings
            </Button>
          </div>
        </div>
      </div>

      {/* Relays Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4" />
          <h3 className="font-medium">Relays</h3>
        </div>

        <div className="space-y-3">
          {/* Relay list */}
          <div className="space-y-2">
            {settings.relays.map((relay) => (
              <div
                key={relay}
                className="flex items-center justify-between bg-muted p-2 rounded"
              >
                <span className="text-sm font-mono truncate flex-1">
                  {relay}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRelay(relay)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add new relay */}
          <div className="flex gap-2">
            <Input
              placeholder="wss://relay.example.com"
              value={newRelay}
              onChange={(e) => setNewRelay(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddRelay();
                }
              }}
            />
            <Button onClick={handleAddRelay} size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Medium Trust Defaults */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-4 w-4" />
          <h3 className="font-medium">Medium Trust Auto-Allow</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Event kinds that are automatically allowed for medium trust origins:
        </p>

        <div className="space-y-2">
          {Object.entries(COMMON_EVENT_KINDS).map(([kind, description]) => {
            const kindNum = parseInt(kind);
            const isEnabled = settings.mediumAllowKinds.includes(kindNum);

            return (
              <div key={kind} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Kind {kind}</div>
                  <div className="text-xs text-muted-foreground">
                    {description}
                  </div>
                </div>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) =>
                    handleToggleMediumKind(kindNum, checked)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-Origin Policies (minimal) */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4" />
          <h3 className="font-medium">Per-Origin Policies</h3>
        </div>
        {settings.origins.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No origins configured yet. Policies appear after first prompt.
          </div>
        )}
        <div className="space-y-3">
          {settings.origins.map((o) => (
            <div key={o.origin} className="border rounded p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">
                    {o.name || o.origin}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Trust: {o.trustLevel}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Session grant</Label>
                  <Switch
                    checked={!!o.sessionGrantAll}
                    onCheckedChange={(v) => setSessionGrant(o.origin, v)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOriginPolicy(o.origin)}
                    title="Remove origin"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Quick rules:
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[1, 6, 7, 9735].map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPerKindRule(
                          o.origin,
                          kind,
                          (o.rules as any)?.[kind] === "deny" ? "ask" : "deny"
                        )
                      }
                    >
                      Kind {kind}: {(o.rules as any)?.[kind] || "—"}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* About Section */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-medium mb-2">About</h3>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Version 1.0.0</p>
          <p>Built with ❤️ for Nostr</p>
          <p className="text-xs pt-2">Settings version: {settings.__version}</p>
        </div>
      </div>

      {/* Development Debug Section */}
      {process.env.NODE_ENV === "development" && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <h3 className="font-medium mb-2 text-yellow-800 dark:text-yellow-200">
            Debug (Dev Mode)
          </h3>
          <details className="text-xs">
            <summary className="cursor-pointer text-yellow-700 dark:text-yellow-300 mb-2">
              View Raw Settings
            </summary>
            <pre className="bg-yellow-100 dark:bg-yellow-900 p-2 rounded text-yellow-900 dark:text-yellow-100 overflow-auto">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </details>
          <div className="mt-2 space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                console.log("Current settings:", settings);
              }}
            >
              Log to Console
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Add a test relay for demonstration
                addRelay("wss://test.relay.dev");
              }}
            >
              Add Test Relay
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

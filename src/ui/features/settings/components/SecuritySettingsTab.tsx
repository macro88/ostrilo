import { Shield, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AutoLockSlider,
  SessionTTLSlider,
} from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useState } from "react";

export function SecuritySettingsTab() {
  const {
    settings,
    isLoading,
    updateAutoLockMinutes,
    updateSessionTTLMinutes,
    resetSettings,
  } = useAppSettings();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Check biometric availability
  useState(() => {
    if ("credentials" in navigator && "create" in navigator.credentials) {
      setBiometricAvailable(true);
    }
  });

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Security Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure authentication and session management
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
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

        <AutoLockSlider
          value={settings.autoLockMinutes}
          onChange={updateAutoLockMinutes}
        />

        <SessionTTLSlider
          value={settings.sessionTTLMinutes}
          onChange={updateSessionTTLMinutes}
        />

        {/* Action buttons */}
        <div className="space-y-2 pt-4 border-t">
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
            Reset All Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

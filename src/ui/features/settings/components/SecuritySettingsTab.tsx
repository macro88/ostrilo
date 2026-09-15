import { Shield, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AutoLockSlider,
  SessionTTLSlider,
} from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useState } from "react";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";

export function SecuritySettingsTab() {
  const {
    settings,
    isLoading,
    updateAutoLockMinutes,
    updateSessionTTLMinutes,
    resetSettings,
  } = useAppSettings();
  const reauth = useReauth();
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Both timeouts are password-gated in the background. The gate is on the
  // change, not on the direction: reasoning about "only when it gets
  // weaker" is how gates end up with holes in them.
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
      // Cancelled. The stored timeout is unchanged.
    }
  };

  const changeSessionTTL = async (minutes: number) => {
    try {
      await reauth.request(
        {
          action: `Change the session grant timeout to ${minutes} minutes.`,
          consequence:
            "A session grant signs for an origin without prompting until it expires.",
        },
        (password) => updateSessionTTLMinutes(minutes, password)
      );
    } catch {
      // Cancelled.
    }
  };
  // The reset patch rewrites both timeouts, so it carries the same gate the
  // sliders do. It used to ask with `confirm()` and then send the patch with no
  // password: the background refused it, nothing reset, and the only trace was
  // a console.error that the production build compiles away.
  const resetAll = async () => {
    try {
      await reauth.request(
        {
          action: "Reset all settings to their defaults.",
          consequence:
            "This clears your relay list, theme, and both timeouts. Your keys are not affected.",
        },
        (password) => resetSettings(password)
      );
    } catch {
      // Cancelled. Settings are unchanged.
    }
  };

  const biometricAvailable =
    "credentials" in navigator && "create" in navigator.credentials;

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="ink-card p-4 space-y-6">
      <div>
        <h2 className="screen-title">Security Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure authentication and session management
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
            <Shield className="h-4 w-4" />
          </div>
          <h3 className="font-medium">Security</h3>
        </div>

        {biometricAvailable && (
          <div className="flex items-center space-x-2 rounded-[10px] border border-border bg-muted/40 p-3">
            <Fingerprint className="h-5 w-5 text-primary" />
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
              aria-label="Enable biometric unlock"
            />
          </div>
        )}

        <AutoLockSlider
          value={settings.autoLockMinutes}
          onChange={changeAutoLock}
        />

        <SessionTTLSlider
          value={settings.sessionTTLMinutes}
          onChange={changeSessionTTL}
        />

        <ReauthDialog {...reauth.dialogProps} />

        {/* Action buttons */}
        <div className="space-y-2 border-t border-border pt-4">
          <Button variant="outline" className="w-full text-left" disabled>
            Change Password
          </Button>
          <Button variant="outline" className="w-full text-left" disabled>
            Export Private Key
          </Button>
          <Button
            variant="destructive"
            className="w-full"
            onClick={resetAll}
          >
            Reset All Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

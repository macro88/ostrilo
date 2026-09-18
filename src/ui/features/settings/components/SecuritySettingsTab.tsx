import { Button } from "@/components/ui/button";
import {
  AutoLockSlider,
  SessionTTLSlider,
} from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsRow,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";

/**
 * Only what works. This tab used to carry a biometric-unlock checkbox bound
 * to local state (the lock screen's handler says the feature is not
 * implemented) and disabled "Change Password" / "Export Private Key" buttons
 * with no handler behind them. A control that cannot do anything is a promise
 * the surface cannot keep, so none of the three is rendered.
 */
export function SecuritySettingsTab() {
  const {
    settings,
    isLoading,
    updateAutoLockMinutes,
    updateSessionTTLMinutes,
    resetSettings,
  } = useAppSettings();
  const reauth = useReauth();

  // Both timeouts are password-gated in the background. The gate is on the
  // change, not on the direction: reasoning about "only when it gets
  // weaker" is how gates end up with holes in them.
  //
  // Neither swallows the cancel. The slider needs to hear it: it is showing a
  // value the store has not accepted yet, and a rejection is what tells it to
  // put the thumb back.
  const changeAutoLock = (minutes: number) =>
    reauth.request(
      {
        action: `Change the auto-lock timeout to ${minutes} minutes.`,
        consequence: "This controls how long an unattended vault stays open.",
      },
      (password) => updateAutoLockMinutes(minutes, password)
    );

  const changeSessionTTL = (minutes: number) =>
    reauth.request(
      {
        action: `Change the session grant timeout to ${minutes} minutes.`,
        consequence:
          "A session grant signs for an origin without prompting until it expires.",
      },
      (password) => updateSessionTTLMinutes(minutes, password)
    );

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

  if (isLoading) {
    return <SettingsLoading />;
  }

  return (
    <div>
      <SettingsTabHeader
        title="Security"
        lede="How long an unlocked vault stays open. Changing either timeout asks for your password."
      />

      <SettingsSection label="Timeouts">
        <div className="ink-card">
          <div className="ink-row">
            <AutoLockSlider
              value={settings.autoLockMinutes}
              onChange={changeAutoLock}
            />
          </div>
          <div className="ink-row">
            <SessionTTLSlider
              value={settings.sessionTTLMinutes}
              onChange={changeSessionTTL}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label="Defaults">
        <div className="ink-card">
          <SettingsRow
            label="Start from the defaults"
            description="Relays, theme and both timeouts go back to their shipped values. Your keys are not affected."
            control={
              <Button
                variant="destructive"
                className="h-10"
                onClick={resetAll}
              >
                Reset All Settings
              </Button>
            }
          />
        </div>
      </SettingsSection>

      <ReauthDialog {...reauth.dialogProps} />
    </div>
  );
}

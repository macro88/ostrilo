import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReauthDialog } from "@/ui/components/dialogs/ReauthDialog";
import { useReauth } from "@/ui/hooks/useReauth";
import {
  AutoLockSlider,
  ThemeSelector,
} from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { AutoLockCountdown } from "@/components/common/AutoLockCountdown";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { openOptionsTab, type OptionsTab } from "@/ui/lib/open-options";

function SettingsHeader() {
  return (
    <div className="screen-header shrink-0">
      <h2 className="screen-title">Settings</h2>
      <p className="screen-description">
        Quick controls for this signer window.
      </p>
    </div>
  );
}

/**
 * A row that leaves for the full settings page, on the tab it names.
 *
 * The popup deliberately does not reproduce those tabs - it is a quick-control
 * surface - but it is where a user goes looking, so the two things they go
 * looking for get a way through rather than a single "All settings" that makes
 * the panel a waiting room.
 */
function SettingsLinkRow({ label, tab }: { label: string; tab?: OptionsTab }) {
  return (
    <button
      type="button"
      onClick={() => openOptionsTab(tab)}
      className="ink-row w-full text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--ink-violet-soft)]"
    >
      <span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
  );
}

export function BasicSettings() {
  const { settings, isLoading, updateTheme, updateAutoLockMinutes } =
    useAppSettings();
  const reauth = useReauth();
  const { lock } = useKeyManager();

  // Same gate as the Security tab. The popup is the surface most likely to
  // be open on an unattended screen, so it is the one that most needs it.
  //
  // The cancel is not swallowed here either: the slider is showing a value the
  // store has not accepted, and the rejection is what sends the thumb back.
  const changeAutoLock = (minutes: number) =>
    reauth.request(
      {
        action: `Change the auto-lock timeout to ${minutes} minutes.`,
        consequence: "This controls how long an unattended vault stays open.",
      },
      (password) => updateAutoLockMinutes(minutes, password)
    );

  // Note: useAppSettings hook already handles storage changes internally via useWxtStorage
  // Settings components will re-render automatically when values change

  if (isLoading) {
    return (
      <div className="screen-shell">
        <SettingsHeader />
        <div className="ink-card overflow-hidden" aria-busy="true">
          {["theme", "lock", "more"].map((row) => (
            <div key={row} className="ink-row" aria-hidden="true">
              <span className="h-2.5 w-1/3 rounded-sm bg-muted motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /*
    No identity block here. The header carries the active key on every tab, so
    a card repeating the same name 130px below it said one thing twice and
    spent a third of the panel doing it. The npub lives on the Profile tab,
    which is the screen about the identity; this one is about the controls.
  */
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 pt-4 [overscroll-behavior:contain] [scrollbar-gutter:stable]">
        <SettingsHeader />

        <section className="shrink-0 space-y-1.5">
          <p className="section-label">Preferences</p>
          <div className="ink-card overflow-hidden">
            <div className="ink-row">
              <ThemeSelector
                value={settings.theme}
                onChange={(theme) => updateTheme(theme)}
              />
            </div>

            {/*
              The `sm` ring, not the settings-page `lg`: the panel is ~360px
              and the slider row already carries a label, a value and a track.
              The ring joins the row rather than displacing any of them.
            */}
            <div className="ink-row">
              <AutoLockSlider
                value={settings.autoLockMinutes}
                onChange={changeAutoLock}
                compact
              />
              <AutoLockCountdown size="sm" />
            </div>
          </div>
        </section>

        <section className="shrink-0 space-y-1.5">
          <p className="section-label">Manage</p>
          <div className="ink-card overflow-hidden">
            <SettingsLinkRow label="Keys & identities" tab="keys" />
            <SettingsLinkRow label="Site permissions" tab="permissions" />
            <SettingsLinkRow label="All settings" />
          </div>
        </section>
      </div>

      {/*
        The panel's decisive action, where Phantom puts it. A signer's quick
        controls are theme and timeout; its one real act is ending the session
        now rather than waiting for the timeout to do it.
      */}
      <div className="shrink-0 space-y-2 px-4 pb-4 pt-3">
        <Button className="h-12 w-full" onClick={() => lock()}>
          Lock now
        </Button>
        <p className="text-center text-[11.5px] text-muted-foreground">
          Locking clears your keys from memory until you unlock.
        </p>
      </div>

      <ReauthDialog {...reauth.dialogProps} />
    </div>
  );
}

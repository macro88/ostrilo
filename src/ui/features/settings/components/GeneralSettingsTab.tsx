import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeSelector } from "@/ui/features/settings/components/shared";
import {
  SettingsLinkRow,
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
  rowSelectTriggerClassName,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { SealMark } from "@/ui/components/common/SealMark";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useWxtStorage } from "@/hooks/useWxtStorage";
import { DOCKED_STORAGE_KEY } from "@/infrastructure/messaging/events";
import { useSidePanelDock } from "@/hooks/useSidePanelDock";
import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { normalizeAutoLockMinutes } from "@/domain/types";
import { resolveSessionTTLMinutes } from "@/domain/policy/session-grants";

type DisplayMode = "popup" | "sidepanel";

function isDisplayMode(value: string): value is DisplayMode {
  return value === "popup" || value === "sidepanel";
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The signer at a glance: the active identity and the one value that matters
 * from each other tab, each row opening that tab. The controls themselves stay
 * where a user looks for them; this is the settings-root list (the shape of
 * Phantom's root, macOS General) that gives the first tab an object of its own.
 * Labels repeat the wording of the controls they summarise.
 */
function AtAGlance() {
  const { settings } = useAppSettings();
  const { keys, selectedUnlockedKey } = useKeyManager();
  const sites = settings.origins?.length ?? 0;

  return (
    <div className="ink-card overflow-hidden">
      <SettingsLinkRow
        href="#keys"
        leading={
          <SealMark
            label={selectedUnlockedKey?.label ?? "?"}
            decorative
            size="lg"
            className="h-10 w-10 text-sm"
          />
        }
        label={selectedUnlockedKey?.label ?? "No active key"}
        description={
          selectedUnlockedKey ? "Active key" : "Choose the key that signs"
        }
        value={count(keys.length, "key", "keys")}
      />
      <SettingsLinkRow
        href="#security"
        label="Auto-lock after inactivity"
        value={`${normalizeAutoLockMinutes(settings.autoLockMinutes)} min`}
      />
      <SettingsLinkRow
        href="#security"
        label="Session grant timeout"
        value={`${resolveSessionTTLMinutes(settings.sessionTTLMinutes)} min`}
      />
      <SettingsLinkRow
        href="#permissions"
        label="Site permissions"
        value={sites === 0 ? "None yet" : count(sites, "site", "sites")}
      />
      <SettingsLinkRow
        href="#relays"
        label="Relays"
        value={count(settings.relays.length, "relay", "relays")}
      />
      <SettingsLinkRow
        href="#activity"
        label="Activity log"
        value={`${settings.maxActivityEntries ?? 50} entries kept`}
      />
    </div>
  );
}

/**
 * Where the extension opens: the toolbar popup or the browser's side panel.
 *
 * Makes three writes: the docked flag the background reapplies on every
 * service worker start, the `sidePanel` setting, and the browser's panel
 * behaviour. Shown as a row with the value on the right (DESIGN_RULES §7).
 */
function OpenInRow() {
  const [, setIsDocked] = useWxtStorage(DOCKED_STORAGE_KEY, false);
  const { supported, enableDocking, disableDocking } = useSidePanelDock();
  const { settings, updateSidePanel } = useAppSettings();

  // Shown while the writes are in flight, so the value does not snap back
  // between the click and the background's settings-changed notification.
  const [pending, setPending] = useState<DisplayMode | null>(null);
  const [failed, setFailed] = useState(false);
  const mode: DisplayMode =
    pending ?? (settings.sidePanel ? "sidepanel" : "popup");

  const handleModeChange = async (next: string) => {
    if (!isDisplayMode(next)) return;
    setPending(next);
    setFailed(false);
    const dock = next === "sidepanel";
    try {
      const writes: Promise<unknown>[] = [
        setIsDocked(dock),
        updateSidePanel(dock),
      ];
      if (supported) {
        writes.push(dock ? enableDocking(true) : disableDocking());
      }
      await Promise.all(writes);
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="ink-row">
      <div className="min-w-0 flex-1">
        <Label
          htmlFor="open-in-mode"
          className="text-sm font-semibold leading-snug"
        >
          Open extension in
        </Label>
        {!supported && mode === "sidepanel" && (
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Side panel is not supported in this browser
          </p>
        )}
        {failed && (
          <p className="mt-0.5 text-[13px] leading-snug text-destructive">
            Could not change where Ostrilo opens. Try again.
          </p>
        )}
      </div>
      <Select value={mode} onValueChange={handleModeChange}>
        <SelectTrigger
          id="open-in-mode"
          size="sm"
          className={rowSelectTriggerClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value="popup">Popup</SelectItem>
          <SelectItem value="sidepanel">Side Panel</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function GeneralSettingsTab() {
  const { settings, isLoading, updateTheme } = useAppSettings();

  if (isLoading) {
    return <SettingsLoading />;
  }

  return (
    <div>
      <SettingsTabHeader
        title="General"
        lede="Your signer at a glance - each row opens its settings."
      />

      <SettingsSection label="At a glance">
        <AtAGlance />
      </SettingsSection>

      <SettingsSection label="Display">
        <div className="ink-card">
          <div className="ink-row">
            <ThemeSelector value={settings.theme} onChange={updateTheme} />
          </div>
          <OpenInRow />
        </div>
      </SettingsSection>
    </div>
  );
}

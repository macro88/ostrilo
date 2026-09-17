import { MediumKindToggles } from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsRow,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";
import { getEffectiveMediumAllowKinds } from "@/domain/policy/trust-definitions";
import { extensionVersion } from "@/ui/lib/extension-version";

export function AdvancedTab() {
  const version = extensionVersion();
  const { settings, isLoading, updateMediumAllowKinds } = useAppSettings();

  if (isLoading) {
    return <SettingsLoading />;
  }

  const handleToggleMediumKind = (kind: number, enabled: boolean) => {
    const currentKinds = getEffectiveMediumAllowKinds(
      settings.mediumAllowKinds
    );
    if (enabled && !currentKinds.includes(kind)) {
      updateMediumAllowKinds([...currentKinds, kind]);
    } else if (!enabled && currentKinds.includes(kind)) {
      updateMediumAllowKinds(currentKinds.filter((k) => k !== kind));
    }
  };

  return (
    <div>
      <SettingsTabHeader
        title="Advanced"
        lede="Sites at medium trust sign these kinds without asking. Everything else still prompts."
      />

      <SettingsSection label="Auto-allowed kinds">
        <MediumKindToggles
          mediumAllowKinds={settings.mediumAllowKinds}
          onToggle={handleToggleMediumKind}
        />
      </SettingsSection>

      <SettingsSection
        label="About"
        note="Open-source signer. Keys never leave your browser."
      >
        <div className="ink-card">
          {version && (
            <SettingsRow
              label="Version"
              control={
                <span className="font-mono text-sm text-muted-foreground">
                  {version}
                </span>
              }
            />
          )}
          <SettingsRow
            label="Settings schema"
            control={
              <span className="font-mono text-sm text-muted-foreground">
                {settings.__version}
              </span>
            }
          />
        </div>
      </SettingsSection>

      {/* Development Debug Section */}
      {process.env.NODE_ENV === "development" && (
        <SettingsSection label="Debug (dev mode)">
          <div className="ink-card bg-ink-amber-soft p-4 text-ink-amber">
            <details className="text-xs">
              <summary className="cursor-pointer mb-2 font-semibold">
                View Raw Settings
              </summary>
              <pre className="code-panel max-h-96">
                {JSON.stringify(settings, null, 2)}
              </pre>
            </details>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

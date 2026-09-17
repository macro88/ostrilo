import { RelayList } from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";

export function RelaysTab() {
  const { settings, isLoading, addRelay, removeRelay } = useAppSettings();

  if (isLoading) {
    return <SettingsLoading />;
  }

  return (
    <div>
      <SettingsTabHeader
        title="Relays"
        lede="Used to read profile names for your keys and to publish edits to your own profile. Nothing else goes through them."
      />

      <SettingsSection label="Relay list">
        <RelayList
          relays={settings.relays}
          onAdd={addRelay}
          onRemove={removeRelay}
        />
      </SettingsSection>
    </div>
  );
}

import { useKeyManager } from "@/ui/features/authentication/hooks/useKeyManager";
import { PublicRelayEditor } from "./PublicRelayEditor";
import { RelayList } from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";

export function RelaysTab() {
  const { settings, isLoading, addRelay, removeRelay } = useAppSettings();

  const { selectedUnlockedKey } = useKeyManager();
  if (isLoading) {
    return <SettingsLoading />;
  }

  return (
    <div>
      <SettingsTabHeader
        title="Relays"
        lede="Choose where other apps find this key and where Ostrilo looks up profiles."
      />

      <SettingsSection
        label={
          selectedUnlockedKey
            ? `Relay list · ${selectedUnlockedKey.label}`
            : "Relay list"
        }
      >
        {selectedUnlockedKey ? (
          <PublicRelayEditor
            key={selectedUnlockedKey.id}
            keyId={selectedUnlockedKey.id}
            discovery={settings.relays}
          />
        ) : (
          <p>Select a key to view its public relay list.</p>
        )}
      </SettingsSection>
      <SettingsSection label="Discovery relays">
        <RelayList
          relays={settings.relays}
          onAdd={addRelay}
          onRemove={removeRelay}
        />
      </SettingsSection>
    </div>
  );
}

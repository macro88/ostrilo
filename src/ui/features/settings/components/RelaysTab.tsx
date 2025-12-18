import { Globe } from "lucide-react";
import { RelayList } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";

export function RelaysTab() {
  const { settings, isLoading, addRelay, removeRelay } = useAppSettings();

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
        <h2 className="text-lg font-semibold mb-2">Relays</h2>
        <p className="text-sm text-muted-foreground">
          Manage your Nostr relay connections
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Globe className="h-4 w-4" />
        <h3 className="font-medium">Relay List</h3>
      </div>

      <RelayList
        relays={settings.relays}
        onAdd={addRelay}
        onRemove={removeRelay}
      />
    </div>
  );
}

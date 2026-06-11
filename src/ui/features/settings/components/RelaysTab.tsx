import { Globe } from "lucide-react";
import { RelayList } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";

export function RelaysTab() {
  const { settings, isLoading, addRelay, removeRelay } = useAppSettings();

  if (isLoading) {
    return (
      <div className="py-12">
        <LoadingSpinner label="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="ink-card p-4 space-y-6">
      <div>
        <h2 className="screen-title">Relays</h2>
        <p className="text-sm text-muted-foreground">
          Manage your Nostr relay connections
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
          <Globe className="h-4 w-4" />
        </div>
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

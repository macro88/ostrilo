import { Clock } from "lucide-react";
import { MediumKindToggles } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";

export function AdvancedTab() {
  const { settings, isLoading, updateMediumAllowKinds } = useAppSettings();

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  const handleToggleMediumKind = (kind: number, enabled: boolean) => {
    const currentKinds = settings.mediumAllowKinds;
    if (enabled && !currentKinds.includes(kind)) {
      updateMediumAllowKinds([...currentKinds, kind]);
    } else if (!enabled && currentKinds.includes(kind)) {
      updateMediumAllowKinds(currentKinds.filter((k) => k !== kind));
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Advanced Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure advanced features and debug information
        </p>
      </div>

      {/* Medium Trust Defaults */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="h-4 w-4" />
          <h3 className="font-medium">Medium Trust Auto-Allow</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Event kinds that are automatically allowed for medium trust origins:
        </p>

        <MediumKindToggles
          mediumAllowKinds={settings.mediumAllowKinds}
          onToggle={handleToggleMediumKind}
        />
      </div>

      {/* About Section */}
      <div className="border-t pt-6 mt-6">
        <h3 className="font-medium mb-2">About</h3>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Version 1.0.0</p>
          <p>Built with ❤️ for Nostr</p>
          <p className="text-xs pt-2">Settings version: {settings.__version}</p>
        </div>
      </div>

      {/* Development Debug Section */}
      {process.env.NODE_ENV === "development" && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mt-6">
          <h3 className="font-medium mb-2 text-yellow-800 dark:text-yellow-200">
            Debug (Dev Mode)
          </h3>
          <details className="text-xs">
            <summary className="cursor-pointer text-yellow-700 dark:text-yellow-300 mb-2">
              View Raw Settings
            </summary>
            <pre className="bg-yellow-100 dark:bg-yellow-900 p-2 rounded text-yellow-900 dark:text-yellow-100 overflow-auto max-h-96">
              {JSON.stringify(settings, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

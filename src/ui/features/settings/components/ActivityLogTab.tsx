import { Clock } from "lucide-react";
import { ActivityLogConfig } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";

function handleExport() {
  // TODO: Implement log export functionality
  console.log("Export log");
}

export function ActivityLogTab() {
  const {
    settings,
    isLoading,
    updateMaxActivityEntries,
    clearActivityLog,
  } = useAppSettings();

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
        <h2 className="screen-title">Activity Log</h2>
        <p className="text-sm text-muted-foreground">
          Configure activity log retention and management
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
          <Clock className="h-4 w-4" />
        </div>
        <h3 className="font-medium">Log Configuration</h3>
      </div>

      <ActivityLogConfig
        maxEntries={settings.maxActivityEntries ?? 50}
        onChange={updateMaxActivityEntries}
        onClear={clearActivityLog}
        onExport={handleExport}
      />
    </div>
  );
}

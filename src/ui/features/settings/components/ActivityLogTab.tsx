import { Clock } from "lucide-react";
import { ActivityLogConfig } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";
import { LoadingSpinner } from "@/ui/components/common/LoadingSpinner";

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

  const handleExport = () => {
    // TODO: Implement log export functionality
    console.log("Export log");
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Activity Log</h2>
        <p className="text-sm text-muted-foreground">
          Configure activity log retention and management
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-4 w-4" />
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

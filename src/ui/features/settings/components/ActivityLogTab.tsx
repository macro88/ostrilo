import { ActivityLogConfig } from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";
import { activityGetRecent } from "@/infrastructure/messaging/client";
import { useState } from "react";

type ExportStatus = "idle" | "busy" | "success" | "error";

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function exportActivityLog(maxEntries: number) {
  const { entries, total } = await activityGetRecent({
    limit: maxEntries,
    offset: 0,
  });
  const exportedAt = new Date().toISOString();

  downloadJson(`ostrilo-activity-log-${exportedAt.slice(0, 10)}.json`, {
    exportedAt,
    total,
    entries,
  });
}

const STATUS_COPY: Record<ExportStatus, string> = {
  idle: "Exports stay local to this browser and include activity entries only.",
  busy: "Exporting the activity log...",
  success: "Activity log exported as a local JSON file.",
  error: "Could not export the activity log. Try again from this page.",
};

export function ActivityLogTab() {
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const {
    settings,
    isLoading,
    updateMaxActivityEntries,
    clearActivityLog,
  } = useAppSettings();

  const handleExport = async () => {
    setExportStatus("busy");

    try {
      await exportActivityLog(settings.maxActivityEntries ?? 50);
      setExportStatus("success");
    } catch {
      setExportStatus("error");
    }
  };

  if (isLoading) {
    return <SettingsLoading />;
  }

  return (
    <div>
      <SettingsTabHeader
        title="Activity Log"
        lede="The signer records every request it answers. The log stays in this browser."
      />

      <SettingsSection
        label="Stored entries"
        note={<span role="status">{STATUS_COPY[exportStatus]}</span>}
      >
        <ActivityLogConfig
          maxEntries={settings.maxActivityEntries ?? 50}
          onChange={updateMaxActivityEntries}
          onClear={clearActivityLog}
          onExport={handleExport}
          exportDisabled={exportStatus === "busy"}
          exportLabel={exportStatus === "busy" ? "Exporting..." : "Export Log"}
        />
      </SettingsSection>
    </div>
  );
}

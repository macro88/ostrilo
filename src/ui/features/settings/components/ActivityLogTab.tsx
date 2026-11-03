import { ActivityLogConfig } from "@/ui/features/settings/components/shared";
import {
  SettingsLoading,
  SettingsSection,
  SettingsTabHeader,
} from "@/ui/features/settings/components/shared/SettingsLayout";
import { useAppSettings } from "@/hooks/useAppSettings";
import { activityGetRecent } from "@/infrastructure/messaging/client";
import { parseActivityReason, type ActivityLogEntry } from "@/domain/types";
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

// The RPC and the service both cap one request at 100 entries, so a log kept
// longer than that is read in pages.
const ACTIVITY_PAGE_SIZE = 100;

async function readActivityEntries(maxEntries: number) {
  const entries: ActivityLogEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  let offset = 0;

  while (entries.length < maxEntries) {
    const limit = Math.min(ACTIVITY_PAGE_SIZE, maxEntries - entries.length);
    const page = await activityGetRecent({ limit, offset });
    offset += page.entries.length;
    total = page.total;
    for (const entry of page.entries) {
      // An entry recorded mid-export shifts later pages by one; skip the
      // repeat rather than export it twice.
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        // Storage is untrusted on read: a reason this build does not
        // recognise is left out of the file rather than copied into it.
        entries.push({ ...entry, reason: parseActivityReason(entry.reason) });
      }
    }
    if (page.entries.length < limit || offset >= total) break;
  }

  return { entries, total };
}

async function exportActivityLog(maxEntries: number) {
  const { entries, total } = await readActivityEntries(maxEntries);
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

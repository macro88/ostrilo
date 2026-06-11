import { Computer } from "lucide-react";
import { OpenInSelector } from "@/components/navigation/open-in-selector";
import { ThemeSelector } from "@/ui/features/settings/components/shared";
import { useAppSettings } from "@/hooks/useAppSettings";

export function GeneralSettingsTab() {
  const { settings, isLoading, updateTheme } = useAppSettings();

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="ink-card p-4 space-y-6">
      <div>
        <h2 className="screen-title">General Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure display and interface preferences
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="seal inline-flex shrink-0 items-center justify-center bg-secondary text-secondary-foreground h-8 w-8">
            <Computer className="h-4 w-4" />
          </div>
          <h3 className="font-medium">Display</h3>
        </div>
        <ThemeSelector value={settings.theme} onChange={updateTheme} />
        <OpenInSelector />
      </div>
    </div>
  );
}

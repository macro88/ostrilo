import { Computer } from "lucide-react";
import { SidePanelToggle } from "@/components/navigation/sidepanel-toggle";
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
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">General Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure display and interface preferences
        </p>
      </div>

      {/* Display Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Computer className="h-4 w-4" />
          <h3 className="font-medium">Display</h3>
        </div>
        <ThemeSelector value={settings.theme} onChange={updateTheme} />
        <SidePanelToggle />
      </div>
    </div>
  );
}

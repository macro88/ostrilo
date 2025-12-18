import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useWxtStorage } from "@/hooks/useWxtStorage";
import { useSidePanelDock } from "@/hooks/useSidePanelDock";
import { useEffect, useState } from "react";

type DisplayMode = "popup" | "sidepanel";

/**
 * OpenInSelector - Dropdown to choose how the extension opens
 * Replaces the previous SidePanelToggle switch with clearer UI
 * Maintains backward compatibility with isDocked boolean storage
 */
export const OpenInSelector: React.FC = () => {
  const [isDocked, setIsDocked] = useWxtStorage("sync:isDocked", false);
  const { supported, enableDocking, disableDocking } = useSidePanelDock();
  
  // Derive display mode from isDocked for backward compatibility
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    isDocked ? "sidepanel" : "popup"
  );

  // Sync local state with storage
  useEffect(() => {
    setDisplayMode(isDocked ? "sidepanel" : "popup");
  }, [isDocked]);

  const handleModeChange = async (mode: DisplayMode) => {
    setDisplayMode(mode);
    const shouldDock = mode === "sidepanel";
    setIsDocked(shouldDock);
    
    if (!supported) return;
    
    if (shouldDock) {
      await enableDocking(true);
    } else {
      await disableDocking();
    }
  };

  return (
    <div className="space-y-2 pt-4">
      <Label htmlFor="open-in-mode">Open extension in:</Label>
      <Select value={displayMode} onValueChange={handleModeChange}>
        <SelectTrigger id="open-in-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="popup">Popup</SelectItem>
          <SelectItem value="sidepanel">Side Panel</SelectItem>
        </SelectContent>
      </Select>
      {!supported && displayMode === "sidepanel" && (
        <p className="text-xs text-muted-foreground">
          Side panel is not supported in this browser
        </p>
      )}
    </div>
  );
};

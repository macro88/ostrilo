import * as React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useWxtStorage } from "@/hooks/useWxtStorage";
import { useSidePanelDock } from "@/hooks/useSidePanelDock";

export const SidePanelToggle: React.FC = () => {
  const [isDocked, setIsDocked] = useWxtStorage("sync:isDocked", false);
  const { supported, enableDocking, disableDocking } = useSidePanelDock();

  const handleDockToggle = async (checked: boolean) => {
    setIsDocked(checked);
    if (!supported) return;
    if (checked) {
      await enableDocking(true);
    } else {
      await disableDocking();
    }
  };

  return (
    <div className="flex items-center space-x-2 pt-4">
      <Switch
        id="dock-mode"
        checked={isDocked ?? false}
        onCheckedChange={handleDockToggle}
      />
      <Label htmlFor="dock-mode">Dock to side</Label>
    </div>
  );
};

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { COMMON_EVENT_KINDS } from "@/domain/types";

interface MediumKindTogglesProps {
  mediumAllowKinds: number[];
  onToggle: (kind: number, enabled: boolean) => void;
}

export function MediumKindToggles({
  mediumAllowKinds,
  onToggle,
}: MediumKindTogglesProps) {
  return (
    <div className="space-y-2">
      {Object.entries(COMMON_EVENT_KINDS).map(([kind, description]) => {
        const kindNum = parseInt(kind);
        const isEnabled = mediumAllowKinds.includes(kindNum);

        return (
          <div key={kind} className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Kind {kind}</div>
              <div className="text-xs text-muted-foreground">
                {description}
              </div>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => onToggle(kindNum, checked)}
            />
          </div>
        );
      })}
    </div>
  );
}

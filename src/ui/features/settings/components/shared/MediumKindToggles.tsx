import { Switch } from "@/components/ui/switch";
import { COMMON_EVENT_KINDS } from "@/domain/types";
import { isProtectedKind } from "@/domain/policy/trust-definitions";

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
        const isProtected = isProtectedKind(kindNum);
        const isEnabled = !isProtected && mediumAllowKinds.includes(kindNum);
        const descriptionId = `medium-kind-${kind}-description`;

        return (
          <div key={kind} className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-muted/35 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Kind {kind}</div>
              <div
                id={descriptionId}
                className="text-xs text-muted-foreground"
              >
                {description}
                {isProtected
                  ? " always requires approval and cannot be auto-allowed."
                  : ""}
              </div>
            </div>
            <Switch
              checked={isEnabled}
              disabled={isProtected}
              onCheckedChange={(checked) => {
                if (!isProtected) {
                  onToggle(kindNum, checked);
                }
              }}
              aria-describedby={descriptionId}
              aria-label={
                isProtected
                  ? `Kind ${kind} always requires approval`
                  : `Allow kind ${kind} for medium trust origins`
              }
            />
          </div>
        );
      })}
    </div>
  );
}

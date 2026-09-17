import { Switch } from "@/components/ui/switch";
import { COMMON_EVENT_KINDS } from "@/domain/types";
import { isProtectedKind } from "@/domain/policy/trust-definitions";

interface MediumKindTogglesProps {
  mediumAllowKinds: number[];
  onToggle: (kind: number, enabled: boolean) => void;
}

/**
 * One grouped card, one row per kind (DESIGN_RULES §7): the kind's name, its
 * number in mono, and the switch. Protected kinds keep a disabled switch and
 * say why, so the list stays a complete account of what medium trust covers.
 */
export function MediumKindToggles({
  mediumAllowKinds,
  onToggle,
}: MediumKindTogglesProps) {
  const allowed = new Set(mediumAllowKinds);

  return (
    <div className="ink-card">
      {Object.entries(COMMON_EVENT_KINDS).map(([kind, name]) => {
        const kindNum = parseInt(kind);
        const isProtected = isProtectedKind(kindNum);
        const isEnabled = !isProtected && allowed.has(kindNum);
        const descriptionId = `medium-kind-${kind}-description`;

        return (
          <div key={kind} className="ink-row">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug">{name}</div>
              {isProtected && (
                <p
                  id={descriptionId}
                  className="mt-0.5 text-[13px] leading-snug text-muted-foreground"
                >
                  Always requires approval and cannot be auto-allowed.
                </p>
              )}
            </div>
            <span className="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
              kind {kind}
            </span>
            <Switch
              checked={isEnabled}
              disabled={isProtected}
              onCheckedChange={(checked) => {
                if (!isProtected) {
                  onToggle(kindNum, checked);
                }
              }}
              aria-describedby={isProtected ? descriptionId : undefined}
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

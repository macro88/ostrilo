import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getKindName, OriginPolicy } from "@/domain/types";
import { Trash2 } from "lucide-react";

interface OriginPolicyTableProps {
  origins: OriginPolicy[];
  onUpdateTrust?: (origin: string, trustLevel: string) => void;
  onRemove: (origin: string) => void;
  onToggleSession: (origin: string, enabled: boolean) => void;
  onSetPerKindRule?: (origin: string, kind: number, rule: string) => void;
}

export function OriginPolicyTable({
  origins,
  onUpdateTrust,
  onRemove,
  onToggleSession,
  onSetPerKindRule,
}: OriginPolicyTableProps) {
  if (origins.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No origins configured yet. Policies appear after first prompt.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {origins.map((o) => (
        <div key={o.origin} className="rounded-[10px] border border-border bg-muted/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-sm">{o.name || o.origin}</div>
              <div className="text-xs text-muted-foreground">
                Trust: {o.trustLevel}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs">Session grant</Label>
              <Switch
                checked={!!o.sessionGrantAll}
                onCheckedChange={(v) => onToggleSession(o.origin, v)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `Remove policy for ${o.name || o.origin}? This action cannot be undone.`
                    )
                  ) {
                    onRemove(o.origin);
                  }
                }}
                title="Remove origin"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {onSetPerKindRule && (
            <div className="mt-3 text-xs text-muted-foreground">
              Quick rules:
              <div className="flex gap-2 mt-2 flex-wrap">
                {[1, 6, 7, 9734, 9735].map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={(o.rules as any)?.[kind] === "deny" ? "secondary" : "outline"}
                    onClick={() =>
                      onSetPerKindRule(
                        o.origin,
                        kind,
                        (o.rules as any)?.[kind] === "deny" ? "ask" : "deny"
                      )
                    }
                  >
                    {getKindName(kind)} ({kind}): {(o.rules as any)?.[kind] || "—"}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

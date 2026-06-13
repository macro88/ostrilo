import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getKindName, OriginPolicy } from "@/domain/types";
import { isProtectedKind } from "@/domain/policy/trust-definitions";
import { Trash2 } from "lucide-react";

type PolicyRule = "allow" | "deny" | "ask";

const QUICK_POLICY_KINDS = [
  0,
  3,
  6,
  7,
  10000,
  10001,
  10002,
  30078,
] as const;

const POLICY_RULES: PolicyRule[] = ["ask", "deny", "allow"];

interface OriginPolicyTableProps {
  origins: OriginPolicy[];
  onUpdateTrust?: (origin: string, trustLevel: string) => void;
  onRemove: (origin: string) => void;
  onToggleSession: (origin: string, enabled: boolean) => void;
  onSetPerKindRule?: (origin: string, kind: number, rule: string) => void;
}

export function OriginPolicyTable({
  origins,
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
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold">Quick rules</p>
              <div className="space-y-2">
                {getPolicyKinds(o).map((kind) => {
                  const storedRule = ((o.rules as any)?.[kind] ??
                    "ask") as PolicyRule;
                  const isProtected = isProtectedKind(kind);
                  const activeRule =
                    isProtected && storedRule === "allow" ? "ask" : storedRule;
                  const rules = POLICY_RULES.filter(
                    (rule) => !(isProtected && rule === "allow")
                  );

                  return (
                    <div
                      key={kind}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
                      data-testid={`origin-policy-kind-${kind}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {getKindName(kind)}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          Kind {kind}
                        </p>
                        {isProtected && (
                          <p className="mt-1 max-w-72 text-[11px] font-semibold">
                            Always requires approval before signing.
                          </p>
                        )}
                      </div>
                      <fieldset className="flex min-w-0 flex-wrap gap-1 border-0 p-0">
                        <legend className="sr-only">
                          Set policy for {getKindName(kind)} kind {kind}
                        </legend>
                        {rules.map((rule) => (
                          <Button
                            key={rule}
                            size="sm"
                            variant={
                              activeRule === rule ? "secondary" : "outline"
                            }
                            aria-pressed={activeRule === rule}
                            onClick={() =>
                              onSetPerKindRule(o.origin, kind, rule)
                            }
                          >
                            {formatRule(rule)}
                          </Button>
                        ))}
                      </fieldset>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function getPolicyKinds(policy: OriginPolicy): number[] {
  const policyKinds = new Set<number>(QUICK_POLICY_KINDS);

  for (const kind of Object.keys(policy.rules ?? {})) {
    const numericKind = Number(kind);
    if (Number.isFinite(numericKind)) {
      policyKinds.add(numericKind);
    }
  }

  return Array.from(policyKinds);
}

function formatRule(rule: PolicyRule): string {
  return rule[0].toUpperCase() + rule.slice(1);
}

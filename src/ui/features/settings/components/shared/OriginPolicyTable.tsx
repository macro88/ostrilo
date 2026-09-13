import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getKindName,
  type EvalReason,
  type OriginPolicy,
  type TrustLevel,
} from "@/domain/types";
import {
  DEFAULT_MEDIUM_ALLOW_KINDS,
  isProtectedKind,
} from "@/domain/policy/trust-definitions";
import { evaluatePolicy } from "@/domain/policy/evaluate";
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

const TRUST_LEVELS: TrustLevel[] = ["low", "medium", "high"];

/**
 * What each trust level actually permits, stated in terms of the allowlist
 * rather than in terms of how much the user likes the site. "High" no longer
 * means "sign anything".
 */
const TRUST_LEVEL_COPY: Record<TrustLevel, string> = {
  low: "Asks before signing anything.",
  medium: "Signs only the kinds enabled for medium trust in Security settings.",
  high: "Signs reposts, reactions and your own lists without asking. Everything else still asks.",
};

/** How an effective decision came about, in the user's words. */
const REASON_COPY: Record<EvalReason, string> = {
  locked: "the vault is locked",
  rule: "a rule you set",
  explicit_allow: "a rule you set",
  explicit_deny: "a rule you set",
  trust: "this site's trust level",
  session: "an active session grant",
  session_grant: "an active session grant",
  medium_allow: "this site's trust level",
  protected: "this kind always requires approval",
  fallback: "the default for a site with no trust level",
  default_ask: "the default for a site with no trust level",
};

const DECISION_COPY: Record<PolicyRule, string> = {
  allow: "Signs without asking",
  deny: "Refused",
  ask: "Asks every time",
};

interface OriginPolicyTableProps {
  origins: OriginPolicy[];
  /**
   * Kinds enabled for medium trust. Defaults to the shipped list so the table
   * still reports a truthful decision when a caller has not threaded settings
   * through.
   */
  mediumAllowKinds?: number[];
  onUpdateTrust?: (origin: string, trustLevel: string) => void;
  onRemove: (origin: string) => void;
  onToggleSession: (origin: string, enabled: boolean) => void;
  /**
   * Live grants from the background, by origin, with absolute expiry.
   *
   * The switch used to read `sessionGrantAll`, a display flag in settings
   * that is written on grant and cleared on lock. It went stale the moment
   * a grant expired on its own, so the UI showed an active grant that was
   * no longer active - and offered a revoke for something already gone.
   */
  sessionGrants?: Array<{ origin: string; expiresAt: number }>;
  onSetPerKindRule?: (origin: string, kind: number, rule: string) => void;
}

export function OriginPolicyTable({
  origins,
  mediumAllowKinds,
  onUpdateTrust,
  onRemove,
  onToggleSession,
  sessionGrants,
  onSetPerKindRule,
}: OriginPolicyTableProps) {
  if (origins.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No origins configured yet. Policies appear after first prompt.
      </div>
    );
  }

  const allowKinds = mediumAllowKinds ?? [...DEFAULT_MEDIUM_ALLOW_KINDS];
  const liveGrants = new Map(
    (sessionGrants ?? []).map((g) => [g.origin, g.expiresAt])
  );

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
                checked={
                  sessionGrants
                    ? liveGrants.has(o.origin)
                    : !!o.sessionGrantAll
                }
                onCheckedChange={(v) => onToggleSession(o.origin, v)}
              />
              {liveGrants.has(o.origin) && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  expires {new Date(liveGrants.get(o.origin)!).toLocaleTimeString()}
                </span>
              )}
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
          {onUpdateTrust && (
            <div
              className="mt-3 space-y-2 text-xs text-muted-foreground"
              data-testid={`origin-trust-${o.origin}`}
            >
              <p className="font-semibold">Trust level</p>
              <fieldset className="flex flex-wrap gap-1 border-0 p-0">
                <legend className="sr-only">
                  Set trust level for {o.name || o.origin}
                </legend>
                {TRUST_LEVELS.map((level) => (
                  <Button
                    key={level}
                    size="sm"
                    variant={o.trustLevel === level ? "secondary" : "outline"}
                    aria-pressed={o.trustLevel === level}
                    onClick={() => onUpdateTrust(o.origin, level)}
                  >
                    {formatRule(level)}
                  </Button>
                ))}
              </fieldset>
              <p>{TRUST_LEVEL_COPY[normaliseLevel(o.trustLevel)]}</p>
            </div>
          )}
          {onSetPerKindRule && (
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p className="font-semibold">Quick rules</p>
              <div className="space-y-2">
                {getPolicyKinds(o).map((kind) => {
                  // Ask the engine what will actually happen rather than
                  // reporting the stored rule. A second implementation of the
                  // ladder in React is how a settings surface starts lying.
                  const effective = evaluatePolicy({
                    origin: o.origin,
                    kind,
                    unlocked: true,
                    mediumAllowKinds: allowKinds,
                    policies: origins,
                    sessionGrants: {},
                  });
                  const activeRule = effective.mode as PolicyRule;
                  const isProtected = isProtectedKind(kind);
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
                        <p
                          className="mt-1 max-w-72 text-[11px]"
                          data-testid={`origin-policy-effective-${kind}`}
                        >
                          {DECISION_COPY[activeRule]} - from{" "}
                          {REASON_COPY[effective.reason]}.
                        </p>
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

function normaliseLevel(level: TrustLevel): TrustLevel {
  return TRUST_LEVELS.includes(level) ? level : "low";
}

function formatRule(rule: string): string {
  return rule[0].toUpperCase() + rule.slice(1);
}

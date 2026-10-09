import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SealMark } from "@/ui/components/common/SealMark";
import { cn } from "@/lib/utils";
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
import { formatOrigin } from "@/domain/display/origin";
import {
  DisclosureGrants,
  type DisclosureIdentity,
} from "./DisclosureGrants";

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

/** The trust level as the row's right-hand value. */
const TRUST_LABEL: Record<TrustLevel, string> = {
  low: "Low trust",
  medium: "Medium trust",
  high: "High trust",
};

/**
 * What each trust level actually permits, stated in terms of the allowlist
 * rather than in terms of how much the user likes the site. "High" no longer
 * means "sign anything".
 */
const TRUST_LEVEL_COPY: Record<TrustLevel, string> = {
  low: "Asks before signing anything.",
  medium: "Signs only the kinds enabled for medium trust under Advanced.",
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
  identity_disclosure_denied:
    "you refused to share your public key with this site",
  fallback: "the default for a site with no trust level",
  default_ask: "the default for a site with no trust level",
};

const DECISION_COPY: Record<PolicyRule, string> = {
  allow: "Signs without asking",
  deny: "Refused",
  ask: "Asks every time",
};

/** The public-key decision, as the full sentence the details panel shows. */
const DISCLOSURE_COPY = {
  allow: "This site can read the public keys below",
  deny: "This site is refused your public key",
  ask: "You will be asked next time this site wants it",
} as const;

/** The same decision, short enough for the collapsed row. */
function disclosureShort(decision: keyof typeof DISCLOSURE_COPY, grants: number) {
  if (decision === "allow") {
    return grants === 1 ? "Can read 1 public key" : `Can read ${grants} public keys`;
  }
  return decision === "deny"
    ? "Refused your public key"
    : "Asks before reading your key";
}

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
  /**
   * Revokes a recorded refusal of the public key, so the next `getPublicKey`
   * from that origin prompts again.
   */
  onRevokeDisclosure?: (origin: string) => void;
  /**
   * Withdraws ONE key's grant. The site's grants for other keys stand, and the
   * next `getPublicKey` that would disclose this key prompts again.
   */
  onRevokeDisclosureKey?: (origin: string, keyId: string) => void;
  /** The keys the vault holds, so each grant can be named by its identity. */
  identities?: readonly DisclosureIdentity[];
}

/**
 * One row per site, details on disclosure.
 *
 * Every site used to unroll its trust control, public-key block and eight
 * quick-rule rows at once - about 560px a site, so ten sites meant six
 * screens of scrolling to find one. The row now carries what a user scans
 * for (who, what they may do, whether they hold the public key) and the
 * controls open under it. The details stay in the DOM while collapsed
 * (`hidden`), so nothing about a site is ever more than one click away and a
 * change made in the panel keeps its place in the list.
 */
export function OriginPolicyTable({
  origins,
  mediumAllowKinds,
  onUpdateTrust,
  onRemove,
  onToggleSession,
  sessionGrants,
  onSetPerKindRule,
  onRevokeDisclosure,
  onRevokeDisclosureKey,
  identities,
}: OriginPolicyTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (origins.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No sites yet. A site is listed once a decision about it is recorded.
      </div>
    );
  }

  const allowKinds = mediumAllowKinds ?? [...DEFAULT_MEDIUM_ALLOW_KINDS];
  const liveGrants = new Map(
    (sessionGrants ?? []).map((g) => [g.origin, g.expiresAt])
  );

  const toggle = (origin: string) =>
    setExpanded((current) => ({ ...current, [origin]: !current[origin] }));

  return (
    <ul className="ink-card overflow-hidden" aria-label="Sites with a stored policy">
      {origins.map((o) => {
        const formatted = formatOrigin(o.origin);
        const displayName = o.name || formatted.display;
        const level = normaliseLevel(o.trustLevel);
        const grantedKeyIds = disclosureKeyIds(o);
        const disclosure = normaliseDisclosure(o, grantedKeyIds);
        const liveGrant = liveGrants.get(o.origin);
        const grantOn = sessionGrants
          ? liveGrant !== undefined
          : !!o.sessionGrantAll;
        const open = !!expanded[o.origin];
        const panelId = `origin-panel-${o.origin}`;
        const nameId = `origin-name-${o.origin}`;

        return (
          <li key={o.origin} className="border-t border-border first:border-t-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              aria-labelledby={nameId}
              data-testid={`origin-row-${o.origin}`}
              onClick={() => toggle(o.origin)}
              className="ink-row w-full text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--ink-violet-soft)]"
            >
              <SealMark
                label={o.name || formatted.hostname}
                decorative
                tone="muted"
                size="lg"
                className="h-10 w-10 text-sm"
              />
              <span className="min-w-0 flex-1">
                <span
                  id={nameId}
                  className="block truncate text-sm font-semibold leading-snug"
                >
                  {displayName}
                </span>
                <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted-foreground">
                  {o.name && (
                    <>
                      <span className="font-mono text-xs">{formatted.display}</span>
                      {" · "}
                    </>
                  )}
                  {disclosureShort(disclosure, grantedKeyIds.length)}
                </span>
              </span>
              {grantOn && (
                <span className="seal-chip seal-chip-success">Session</span>
              )}
              <span className="shrink-0 text-sm font-medium text-muted-foreground">
                {TRUST_LABEL[level]}
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
                  open && "rotate-180"
                )}
                aria-hidden="true"
              />
            </button>

            <div
              id={panelId}
              hidden={!open}
              className="space-y-5 border-t border-border py-4 pr-4 pl-4 sm:pl-[4.5rem]"
            >
              {onUpdateTrust && (
                <section data-testid={`origin-trust-${o.origin}`}>
                  <h4 className="section-label">Trust level</h4>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Segmented
                      legend={`Set trust level for ${displayName}`}
                      options={TRUST_LEVELS}
                      value={level}
                      onChange={(next) => onUpdateTrust(o.origin, next)}
                    />
                    <p className="text-[13px] leading-snug text-muted-foreground">
                      {TRUST_LEVEL_COPY[level]}
                    </p>
                  </div>
                </section>
              )}

              <section data-testid={`origin-disclosure-${o.origin}`}>
                <h4 className="section-label">Your public key</h4>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    {DISCLOSURE_COPY[disclosure]}
                  </p>
                  {onRevokeDisclosure && disclosure === "deny" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRevokeDisclosure(o.origin)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
                {disclosure === "allow" && (
                  <DisclosureGrants
                    keyIds={grantedKeyIds}
                    identities={identities ?? []}
                    onRevoke={
                      onRevokeDisclosureKey &&
                      ((keyId) => onRevokeDisclosureKey(o.origin, keyId))
                    }
                  />
                )}
              </section>

              <section>
                <h4 className="section-label">Session grant</h4>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Sign every unprotected kind without asking
                    </p>
                    {liveGrant !== undefined ? (
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        expires {new Date(liveGrant).toLocaleTimeString()}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                        Ends when the grant expires or the vault locks.
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={grantOn}
                    onCheckedChange={(v) => onToggleSession(o.origin, v)}
                  />
                </div>
              </section>

              {onSetPerKindRule && (
                <section>
                  <h4 className="section-label">Rules by kind</h4>
                  <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {getPolicyKinds(o).map((kind) => {
                      // Ask the engine what will actually happen rather than
                      // reporting the stored rule. A second implementation of
                      // the ladder in React is how a settings surface starts
                      // lying.
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
                          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
                          data-testid={`origin-policy-kind-${kind}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground">
                              {getKindName(kind)}
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                kind {kind}
                              </span>
                            </p>
                            {isProtected && (
                              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                                Always requires approval before signing.
                              </p>
                            )}
                            <p
                              className="mt-0.5 text-xs leading-snug text-muted-foreground"
                              data-testid={`origin-policy-effective-${kind}`}
                            >
                              {DECISION_COPY[activeRule]} — from{" "}
                              {REASON_COPY[effective.reason]}.
                            </p>
                          </div>
                          <Segmented
                            legend={`Set policy for ${getKindName(kind)} kind ${kind}`}
                            options={rules}
                            value={activeRule}
                            onChange={(rule) =>
                              onSetPerKindRule(o.origin, kind, rule)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    if (
                      confirm(
                        `Remove policy for ${displayName}? This action cannot be undone.`
                      )
                    ) {
                      onRemove(o.origin);
                    }
                  }}
                >
                  Remove site
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface SegmentedProps<T extends string> {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}

/**
 * Three choices as one joined control, the chosen one on the violet-soft
 * plate. Plain buttons with `aria-pressed`, not radios: each press is a write
 * (sometimes password-gated), and a pressed state that can be refused must
 * not pretend to have moved.
 */
function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset className="inline-flex shrink-0 overflow-hidden rounded-lg border border-input bg-card">
      <legend className="sr-only">{legend}</legend>
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "h-8 px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
            index > 0 && "border-l border-input",
            value === option
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {formatRule(option)}
        </button>
      ))}
    </fieldset>
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

function normaliseLevel(level: TrustLevel | undefined): TrustLevel {
  return level && TRUST_LEVELS.includes(level) ? level : "low";
}

/**
 * The key ids a site may read, as enforced: only an `allow` has any, and a
 * malformed list is read as none rather than guessed at.
 */
function disclosureKeyIds(policy: OriginPolicy): string[] {
  const held: unknown = policy.identityDisclosureKeyIds;
  if (policy.identityDisclosure !== "allow" || !Array.isArray(held)) return [];
  return held.filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * What the site can actually do. An `allow` that names no key discloses
 * nothing, so it is shown as the prompting state it behaves as.
 */
function normaliseDisclosure(
  policy: OriginPolicy,
  grantedKeyIds: readonly string[]
): keyof typeof DISCLOSURE_COPY {
  if (policy.identityDisclosure === "deny") return "deny";
  return grantedKeyIds.length > 0 ? "allow" : "ask";
}

function formatRule(rule: string): string {
  return rule[0].toUpperCase() + rule.slice(1);
}

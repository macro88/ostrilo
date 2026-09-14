import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  DisclosureRequest,
  ApprovalAction,
  KeyRecord,
} from "@/domain/types";
import { formatOrigin } from "@/domain/display/origin";
import { ArrowLeft, Check, Eye, Shield, X } from "lucide-react";
import { SealMark } from "@/components/common/SealMark";

/**
 * The prompt shown when a site asks to read the user's public key.
 *
 * REMEMBER SEMANTICS MATCH THE SIGNING PROMPT EXACTLY. The primary button is
 * allow-ONCE; ticking "Remember this site" upgrades it to a standing allow, and
 * ticking it before Deny records a standing refusal. Two approval screens share
 * one window, so a button in the same position with the same label must not
 * mean "just this once" on one screen and "forever" on the other.
 *
 * The copy deliberately does not call the public key a secret. It is published
 * on relays, and this extension publishes it there itself. What the user is
 * deciding is whether this site may link their browsing to that identity.
 */

/** Matches the approve cooldown in `useApprovalDisplay`. */
const APPROVE_COOLDOWN_MS = 400;

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function truncateMiddle(value: string, lead = 10, tail = 6): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export interface DisclosureDetailViewProps {
  request: DisclosureRequest;
  signingKey: KeyRecord | null;
  countdown: number;
  onResolve: (action: ApprovalAction) => void;
  onBack: () => void;
  showBackButton: boolean;
  isResolving: boolean;
  className?: string;
}

export function DisclosureDetailView({
  request,
  signingKey,
  countdown,
  onResolve,
  onBack,
  showBackButton,
  isResolving,
  className,
}: DisclosureDetailViewProps) {
  const [rememberChoice, setRememberChoice] = useState(false);

  // Approve is briefly disabled whenever the pane binds to a new request; Deny
  // is not. Refusing is always safe, and a user clearing a flood of prompts
  // must never be slowed down on the safe action.
  const [approveReady, setApproveReady] = useState(false);
  useEffect(() => {
    setApproveReady(false);
    const timer = setTimeout(() => setApproveReady(true), APPROVE_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [request.id]);

  const origin = formatOrigin(request.origin);
  const domain = origin.display;
  const pubkey = request.signingPubkey ?? signingKey?.pubkey ?? "";
  const rememberInputId = `remember-${request.id}`;
  const rememberDescriptionId = `${rememberInputId}-description`;

  const handleApprove = () => {
    onResolve(rememberChoice ? "allow" : "allow_once");
  };

  const handleDeny = () => {
    onResolve(rememberChoice ? "deny_remember" : "deny");
  };

  return (
    <div
      className={["flex h-full min-h-0 flex-col bg-background", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="disclosure-detail"
    >
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          {showBackButton && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to approval queue"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="min-w-0 flex-1 text-lg font-bold">
            Identity request
          </h1>
          <span className="seal-chip seal-chip-warning font-mono text-sm">
            {formatCountdown(countdown)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <section className="flex items-start gap-3">
          <SealMark label={domain} size="lg" className="h-12 w-12 text-xl" />
          <div className="min-w-0">
            <h2 className="break-all font-mono text-lg font-bold">{domain}</h2>
            <p className="text-sm font-semibold text-muted-foreground">
              Wants to read your public key.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="seal-chip seal-chip-accent">
                Review required
              </span>
              {origin.insecure && (
                <span className="seal-chip seal-chip-warning">
                  Not a secure connection
                </span>
              )}
              <span className="seal-chip seal-chip-warning font-mono">
                Expires {formatCountdown(countdown)}
              </span>
            </div>
          </div>
        </section>

        <section className="ink-card overflow-hidden">
          <div className="ink-row">
            <span className="w-24 shrink-0 text-sm font-semibold text-muted-foreground">
              Identity
            </span>
            <span className="min-w-0 flex-1 break-all font-mono text-sm">
              {pubkey
                ? truncateMiddle(pubkey, 12, 8)
                : signingKey?.label || "Selected key"}
            </span>
          </div>
        </section>

        {/* Amber panel, no border, per the warning treatment in the design
            rules. This is the one thing the user most needs to understand, and
            the most likely thing for a prompt like this to get wrong. */}
        <section className="rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
          <div className="flex items-start gap-2">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2 text-xs font-semibold">
              <p>
                Your public key is <strong>not a secret</strong>. It is already
                published on Nostr relays, and anyone who has seen you post can
                find it.
              </p>
              <p>
                What this grants is <strong>linkage</strong>: {domain} will be
                able to tie your visit to this Nostr identity, and to everything
                else that identity has ever done.
              </p>
              <p>
                It does not let {domain} sign anything, spend anything, or read
                your private key.
              </p>
            </div>
          </div>
        </section>

        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
          <Shield className="h-4 w-4" />
          Keys never leave your browser.
        </p>
      </div>

      <div className="shrink-0 space-y-3 border-t border-border bg-card p-4">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={isResolving}
            className="h-12"
          >
            <X className="h-4 w-4" />
            Deny
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isResolving || !approveReady}
            className="h-12"
          >
            <Check className="h-4 w-4" />
            Share public key
          </Button>
        </div>

        <div
          className="space-y-2 text-sm text-muted-foreground"
          data-testid="disclosure-remember-copy"
        >
          <div className="flex items-center justify-center gap-2 font-semibold">
            <input
              id={rememberInputId}
              type="checkbox"
              className="h-5 w-5 rounded border-input accent-[var(--ink-violet)]"
              checked={rememberChoice}
              aria-label="Remember this decision for this site"
              aria-describedby={rememberDescriptionId}
              onChange={(event) => setRememberChoice(event.target.checked)}
            />
            <label htmlFor={rememberInputId}>Remember this site</label>
          </div>
          <p id={rememberDescriptionId} className="text-center text-xs">
            {rememberChoice
              ? `${domain} will not ask again. You can change this in Settings → Permissions.`
              : `This choice applies to this request only. ${domain} will ask again next time.`}
          </p>
        </div>
      </div>
    </div>
  );
}

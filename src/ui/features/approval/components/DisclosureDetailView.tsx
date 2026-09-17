import { useState } from "react";
import type {
  DisclosureRequest,
  ApprovalAction,
  KeyRecord,
} from "@/domain/types";
import { formatOrigin } from "@/domain/display/origin";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApproveCooldown, type OriginTrust } from "./useApprovalDisplay";
import {
  ApprovalActions,
  ApprovalHeader,
  OriginBlock,
  RememberControl,
  SigningAsRow,
  useCopyFeedback,
} from "./EventDetailView";

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

export interface DisclosureDetailViewProps {
  request: DisclosureRequest;
  signingKey: KeyRecord | null;
  countdown: number;
  onResolve: (action: ApprovalAction) => void;
  onBack: () => void;
  showBackButton: boolean;
  isResolving: boolean;
  /** Where the origin stands with the user. Absent while settings load. */
  originTrust?: OriginTrust;
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
  originTrust,
  className,
}: DisclosureDetailViewProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  // Same cooldown as the signing prompt, for the same reason: a click already
  // in motion must not land on a share button that appeared underneath it.
  const approveReady = useApproveCooldown(request.id);
  const copy = useCopyFeedback();

  const origin = formatOrigin(request.origin);
  const domain = origin.display;
  const pubkey = request.signingPubkey ?? signingKey?.pubkey ?? "";
  const keyLabel =
    signingKey && signingKey.pubkey === pubkey ? signingKey.label : undefined;

  const handleApprove = () => {
    onResolve(rememberChoice ? "allow" : "allow_once");
  };

  const handleDeny = () => {
    onResolve(rememberChoice ? "deny_remember" : "deny");
  };

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      data-testid="disclosure-detail"
    >
      <ApprovalHeader
        title="Identity request"
        countdown={countdown}
        onBack={showBackButton ? onBack : undefined}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <OriginBlock
          origin={origin}
          trust={originTrust}
          sentence="Sharing tells this site which Nostr identity you are."
        />

        <section className="ink-card" aria-label="Request facts">
          <SigningAsRow
            label="Identity"
            pubkey={pubkey}
            keyLabel={keyLabel}
            copy={copy}
          />
        </section>

        {/* Amber panel, no border, per the warning treatment in the design
            rules. This is the one thing the user most needs to understand, and
            the most likely thing for a prompt like this to get wrong. */}
        <section className="flex items-start gap-3 rounded-[10px] bg-[var(--ink-amber-soft)] p-4 text-[var(--ink-amber)]">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2 text-xs font-semibold leading-[1.45]">
            <p>
              Your public key is <strong>not a secret</strong>. It is already
              published on Nostr relays.
            </p>
            <p>
              What this grants is <strong>linkage</strong>: {domain} can tie
              your visit to this identity, and to everything it has ever
              posted.
            </p>
            <p>It cannot sign anything or read your private key.</p>
          </div>
        </section>
      </div>

      <ApprovalActions
        approveLabel="Share public key"
        onApprove={handleApprove}
        onDeny={handleDeny}
        approveDisabled={isResolving || !approveReady}
        denyDisabled={isResolving}
      >
        <RememberControl
          requestId={request.id}
          checked={rememberChoice}
          onChange={setRememberChoice}
          label="Remember this site"
          testId="disclosure-remember-copy"
        >
          <p>
            {domain} will not ask again. You can change this in Settings →
            Permissions.
          </p>
        </RememberControl>
      </ApprovalActions>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { OriginPolicy, SigningRequest } from "@/domain/types";
import { normaliseTrustLevel } from "@/domain/policy/trust-definitions";
import { formatOrigin, type FormattedOrigin } from "@/domain/display/origin";
import {
  escapeInvisible,
  byteLength,
  tagsByteLength,
} from "@/domain/display/safe-text";

/**
 * Milliseconds the approve action stays disabled after the detail pane binds
 * to a request it was not previously showing.
 *
 * Short enough not to be felt by someone reading; long enough that a click
 * already in motion lands on a disabled button rather than on an approval for
 * an event that appeared underneath it.
 */
export const APPROVE_COOLDOWN_MS = 500;

export interface ApprovalDisplay {
  /** Full origin including scheme, with an insecure flag. */
  origin: FormattedOrigin;
  /** Content with invisible and direction-control characters escaped. */
  content: string;
  /** How many characters the escape transform replaced, across the event. */
  hiddenCharacters: number;
  /** True UTF-8 byte length of the content. */
  contentBytes: number;
  /** True UTF-8 byte length across every tag element. */
  tagBytes: number;
  /** The key that will actually sign, bound to the request at enqueue time. */
  signingPubkey: string;
  /** False while the approve action is in its post-bind cooldown. */
  approveReady: boolean;
}

/**
 * True once `requestId` has been on screen for APPROVE_COOLDOWN_MS.
 *
 * Approve is briefly disabled whenever the pane binds to a new request. Deny
 * is NOT: refusing is always safe, and a user trying to clear a flood of
 * prompts must never be slowed down on the safe action.
 *
 * Readiness is keyed by request id rather than reset on change: when the pane
 * binds to a different request the stored id simply stops matching, so no
 * state has to be written synchronously inside the effect.
 */
export function useApproveCooldown(requestId: string): boolean {
  const [readyFor, setReadyFor] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setReadyFor(requestId), APPROVE_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [requestId]);

  return readyFor === requestId;
}

/**
 * Everything the approval dialog needs in order to describe a request
 * truthfully.
 *
 * All of it is DISPLAY-ONLY. The bytes that get hashed and signed are never
 * touched: substituting them would sign something other than what the page
 * asked for, which is a worse failure than a misleading display.
 */
export function useApprovalDisplay(
  request: SigningRequest,
  fallbackPubkey?: string
): ApprovalDisplay {
  const derived = useMemo(() => {
    const safeContent = escapeInvisible(request.event.content);
    const safeTags = request.event.tags.map((tag) =>
      tag.map((element) => escapeInvisible(element))
    );
    return {
      origin: formatOrigin(request.origin),
      content: safeContent.text,
      hiddenCharacters:
        safeContent.escapedCount +
        safeTags.reduce(
          (sum, tag) => sum + tag.reduce((s, el) => s + el.escapedCount, 0),
          0
        ),
      contentBytes: byteLength(request.event.content),
      tagBytes: tagsByteLength(request.event.tags),
    };
  }, [request]);

  const approveReady = useApproveCooldown(request.id);

  return {
    ...derived,
    // Bound to the REQUEST at enqueue time. This used to read whichever key the
    // approval UI had selected when it loaded, so switching the active key
    // while a prompt was open changed the displayed identity without changing
    // the one that would sign.
    signingPubkey: request.signingPubkey ?? fallbackPubkey ?? "",
    approveReady,
  };
}

/**
 * Where the requesting origin stands with the user, for the chip on the
 * origin block (DESIGN_RULES §8).
 *
 * - `first_visit`: no policy record exists. Nothing has ever been decided
 *   about this site, so the chip is red.
 * - `known`: a record exists at `low` trust. A record is written as a side
 *   effect of any signing decision, including a refusal, so this means only
 *   "you have answered this site before" - it is not a grant of anything.
 * - `medium`: the user set medium trust, which auto-signs only the kinds
 *   enabled for it in Security settings. Named by its level, so it cannot be
 *   mistaken for the standing grant below.
 * - `trusted`: the user raised the site to `high` trust - the "known-trusted"
 *   state §8 reserves the mint chip for.
 */
export type OriginTrust = "first_visit" | "known" | "medium" | "trusted";

export function describeOriginTrust(
  origin: string,
  policies: readonly OriginPolicy[]
): OriginTrust {
  const policy = policies.find((candidate) => candidate.origin === origin);
  if (!policy) return "first_visit";
  switch (normaliseTrustLevel(policy.trustLevel)) {
    case "high":
      return "trusted";
    case "medium":
      return "medium";
    default:
      return "known";
  }
}

/**
 * The one sentence under the origin: what approving actually lets the site
 * do. Stated as a consequence, not as a restatement of the title, and honest
 * about the fact that signing does not itself publish - the site does.
 */
const SIGNING_CONSEQUENCES: Record<number, string> = {
  0: "Signing lets this site rewrite your profile.",
  1: "Signing lets this site publish a note as you.",
  3: "Signing lets this site rewrite your contact list.",
  4: "Signing lets this site send a direct message as you.",
  5: "Signing lets this site ask relays to delete your posts. That cannot be undone.",
  6: "Signing lets this site repost as you.",
  7: "Signing lets this site react to a post as you.",
  16: "Signing lets this site repost as you.",
  9734: "Signing lets this site request a zap invoice as you.",
  10002: "Signing lets this site rewrite your relay list.",
  22242: "Signing logs this site in to a relay as you.",
  27235: "Signing lets this site log in to a web service as you.",
};

const DEFAULT_SIGNING_CONSEQUENCE =
  "Once signed, anyone holding this event can publish it as yours.";

export function describeSigningConsequence(kind: number): string {
  return SIGNING_CONSEQUENCES[kind] ?? DEFAULT_SIGNING_CONSEQUENCE;
}

/**
 * Whether the content panel needs its "end of content" marker.
 *
 * The marker exists so nothing can hide below the panel's internal fold. The
 * panel scrolls at 240px, which fits roughly ten lines of mono at this width,
 * so content that cannot reach that height is shown whole and needs no marker
 * - under a one-line note it reads as debug output. The thresholds are set well
 * inside the limit: anything long enough to be in doubt gets the marker.
 */
export function needsEndOfContentMarker(content: string): boolean {
  return content.length > 240 || content.split("\n").length > 6;
}

/** `m:ss`, never negative. Countdowns are always mono, always amber (§8). */
export function formatCountdown(seconds: number): string {
  const remaining = Math.max(0, seconds);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Middle-truncation for hex keys and hashes (§7). */
export function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * The event's own `created_at`, with the year kept on purpose: a site that
 * backdates or postdates an event should be seen doing it.
 */
export function formatEventTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

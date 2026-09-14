import { useEffect, useMemo, useState } from "react";
import type { SigningRequest } from "@/domain/types";
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

  // Approve is briefly disabled whenever the pane binds to a new request. Deny
  // is NOT: refusing is always safe, and a user trying to clear a flood of
  // prompts must never be slowed down on the safe action.
  const [approveReady, setApproveReady] = useState(false);
  useEffect(() => {
    setApproveReady(false);
    const timer = setTimeout(() => setApproveReady(true), APPROVE_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [request.id]);

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

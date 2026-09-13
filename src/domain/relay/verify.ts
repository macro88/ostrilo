import { RelayEventSchema, type RelayEvent } from "./schemas";

/**
 * The two cryptographic operations relay verification needs.
 *
 * Declared structurally, like {@link RelayFilterExpectation} above it, so the
 * domain layer keeps no dependency on the application ports and imports no
 * cryptographic library. The caller supplies the single implementations:
 * `computeEventId` from `src/application/crypto/event-id.ts` bound to a hash
 * adapter, and `verifyEventSignature` from the same module bound to the
 * Schnorr adapter.
 *
 * This is a required parameter rather than a default, because a default
 * would be a second place that decides how an event id is computed.
 */
export interface RelayEventCrypto {
  computeEventId(event: {
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  }): string;
  verifyEventSignature(
    eventIdHex: string,
    signatureHex: string,
    pubkeyHex: string
  ): boolean;
}

/**
 * Why a relay event was refused. Callers log the reason; they never log the
 * relay payload that produced it.
 */
export type RelayEventRejection =
  | "schema"
  | "author-mismatch"
  | "kind-mismatch"
  | "id-mismatch"
  | "bad-signature";

export type RelayEventVerification =
  | { ok: true; event: RelayEvent }
  | { ok: false; reason: RelayEventRejection };

/**
 * The part of a subscription filter that constrains which events the extension
 * asked for. Declared structurally so the domain layer keeps no dependency on
 * the application port.
 */
export interface RelayFilterExpectation {
  authors?: string[];
  kinds?: number[];
}

/**
 * True when a candidate event is one the subscription actually asked for.
 *
 * A filter field that is absent constrains nothing, matching NIP-01. A filter
 * field that is present is a closed set: this is what stops a relay answering a
 * request about one author with data about another.
 */
export function matchesFilter(
  event: Pick<RelayEvent, "pubkey" | "kind">,
  filter: RelayFilterExpectation | undefined
): boolean {
  if (!filter) {
    return true;
  }

  if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) {
    return false;
  }

  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) {
    return false;
  }

  return true;
}

/**
 * Validate, match and cryptographically verify one relay-supplied event.
 *
 * Checks run cheapest first - schema, then the subscription filter, then the
 * event-ID recomputation, and only then the Schnorr verification - so a relay
 * flooding a subscription cannot buy curve operations with cheap bytes.
 *
 * Never throws: a malformed payload is a rejection, not an exception, because
 * the caller is a WebSocket message handler whose stack has nowhere to unwind.
 */
export function verifyRelayEvent(
  crypto: RelayEventCrypto,
  payload: unknown,
  filter?: RelayFilterExpectation
): RelayEventVerification {
  const parsed = RelayEventSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "schema" };
  }

  return verifyParsedRelayEvent(crypto, parsed.data, filter);
}

/**
 * The match-and-verify half of {@link verifyRelayEvent}, for callers that have
 * already validated the event against {@link RelayEventSchema} and should not
 * pay to parse it twice.
 */
export function verifyParsedRelayEvent(
  crypto: RelayEventCrypto,
  event: RelayEvent,
  filter?: RelayFilterExpectation
): RelayEventVerification {
  if (Array.isArray(filter?.authors) && !filter.authors.includes(event.pubkey)) {
    return { ok: false, reason: "author-mismatch" };
  }

  if (Array.isArray(filter?.kinds) && !filter.kinds.includes(event.kind)) {
    return { ok: false, reason: "kind-mismatch" };
  }

  let recomputedId: string;
  try {
    recomputedId = crypto.computeEventId(event);
  } catch {
    return { ok: false, reason: "id-mismatch" };
  }

  if (recomputedId !== event.id) {
    return { ok: false, reason: "id-mismatch" };
  }

  if (!crypto.verifyEventSignature(event.id, event.sig, event.pubkey)) {
    return { ok: false, reason: "bad-signature" };
  }

  return { ok: true, event };
}

import type { CryptoHash, Schnorr } from "@/application/ports/crypto";
import {
  serializeEventForId,
  type EventIdFields,
} from "@/domain/nostr/event-serialization";
import { assertHexBytes, bytesToHex, isValidHex } from "@/domain/utils/hex";

/**
 * The one NIP-01 event id implementation in `src/`.
 *
 * Every call site - `KeyVaultService.signEvent`, both `NostrRpcHandler` paths
 * and the relay trust boundary - reaches this function. It used to be a
 * function in `domain/utils/crypto.ts` that imported `@noble/hashes` directly
 * from inside the domain layer; the hash now arrives through a port, which is
 * what lets the serializer stay pure and the primitive stay in one place.
 *
 * `hash` is a parameter rather than a constructor dependency because both the
 * vault service and the RPC handler need an event id and neither should own
 * the hash.
 */
export function computeEventId(hash: CryptoHash, event: EventIdFields): string {
  const preimage = serializeEventForId(
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  );
  return bytesToHex(hash.sha256(new TextEncoder().encode(preimage)));
}

/**
 * Verifies a BIP-340 signature over an event id.
 *
 * Every argument is hex from an untrusted source - a relay frame, a stored
 * record - so malformed input is a failed verification, never an exception.
 * The previous implementation decoded all three with `parseInt` and no
 * character validation, so a non-hex signature became a run of zero bytes and
 * was then verified as if it were a real one.
 */
export function verifyEventSignature(
  schnorr: Pick<Schnorr, "verify">,
  eventIdHex: string,
  signatureHex: string,
  pubkeyHex: string
): boolean {
  if (
    !isValidHex(eventIdHex, 32) ||
    !isValidHex(signatureHex, 64) ||
    !isValidHex(pubkeyHex, 32)
  ) {
    return false;
  }

  try {
    return schnorr.verify(
      assertHexBytes(signatureHex, 64),
      assertHexBytes(eventIdHex, 32),
      assertHexBytes(pubkeyHex, 32)
    );
  } catch {
    return false;
  }
}

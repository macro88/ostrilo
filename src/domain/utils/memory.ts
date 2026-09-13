/**
 * Best-effort memory hygiene for secret byte buffers.
 *
 * Moved out of `domain/utils/crypto.ts`, which was a grab-bag holding a second
 * copy of every primitive in the product. This function was the one thing in
 * that module that was genuinely pure and genuinely used, so it gets a home
 * that does not tempt anyone into importing a duplicate KDF alongside it.
 */

/**
 * Overwrites a `Uint8Array` with zeros.
 *
 * The honest limits: this clears the buffer the caller owns and nothing else.
 * It cannot reach a copy the engine made, a `CryptoKey` the platform holds, or
 * a JavaScript string - strings are immutable and cannot be erased at all.
 */
export function zeroize(buffer: Uint8Array): void {
  if (buffer && buffer.fill) {
    buffer.fill(0);
  }
}

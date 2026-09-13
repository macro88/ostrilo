/**
 * The hex codec. One implementation, no dependencies, and it fails loudly.
 *
 * This replaces four decoders that were spread across `domain/utils/crypto.ts`,
 * `domain/utils/encoding.ts` and `KeyVaultService`. The one in `encoding.ts`
 * checked only that the input length was even: `parseInt("zz", 16)` is `NaN`,
 * and assigning `NaN` into a `Uint8Array` stores `0`, so
 * `hexToBytes("zz".repeat(32))` returned 32 zero bytes and threw nothing. Two
 * live call sites passed a stored public key straight into it, which meant a
 * corrupt record rendered as a perfectly well-formed npub for a key nobody
 * holds.
 *
 * A decoder that turns bad input into plausible-looking output is worse than
 * one that crashes, because the corruption travels. Everything here throws.
 */

const HEX_CHARS = /^[0-9a-fA-F]*$/;

/** Lowercase hex. The only encoder in `src/`. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Decodes hex, or throws.
 *
 * Validates the whole string before allocating, so a partially valid input
 * cannot yield the bytes it managed to decode before the malformed pair.
 * Accepts upper and lower case; rejects a `0x` prefix, which is a caller's job
 * to strip if it means to allow one.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(
      `Invalid hex length: expected an even number of characters, got ${hex.length}`
    );
  }
  if (!HEX_CHARS.test(hex)) {
    throw new Error("Invalid hex: input contains non-hexadecimal characters");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * True when `hex` decodes cleanly, and - when `expectedByteLength` is given -
 * decodes to exactly that many bytes.
 *
 * `expectedByteLength` is in BYTES, not characters, matching every call site:
 * a Nostr public key is `isValidHex(value, 32)`.
 */
export function isValidHex(hex: string, expectedByteLength?: number): boolean {
  if (hex.length === 0 || hex.length % 2 !== 0) return false;
  if (!HEX_CHARS.test(hex)) return false;
  if (expectedByteLength !== undefined && hex.length !== expectedByteLength * 2) {
    return false;
  }
  return true;
}

/**
 * Decodes hex of an exact byte length, or throws.
 *
 * The length is checked before the characters so the error names the more
 * useful fault first: a caller that passed a 63-character key wants to be told
 * about the length, not about the byte it stopped on.
 */
export function assertHexBytes(input: string, byteLength: number): Uint8Array {
  if (input.length !== byteLength * 2) {
    throw new Error(
      `Invalid hex length: expected ${byteLength * 2} characters, got ${input.length}`
    );
  }
  return hexToBytes(input);
}

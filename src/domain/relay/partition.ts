/**
 * Relay assignment for background profile hydration.
 *
 * Querying every configured relay for every managed pubkey is the maximally
 * correlating choice: each relay learns the user's whole identity set. Assigning
 * each pubkey to exactly one relay is the minimally correlating choice that
 * still uses the configured set.
 *
 * The mapping is salted per install so the partition is not globally
 * predictable, which stops relays colluding on a known assignment.
 */

/** Length of the per-install partition salt, in hex characters. */
const SALT_HEX_CHARS = 32;

/**
 * Generate a per-install partition salt.
 */
export function createPartitionSalt(): string {
  const bytes = new Uint8Array(SALT_HEX_CHARS / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * True when a stored value is usable as a partition salt.
 */
export function isPartitionSalt(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

/**
 * FNV-1a over the salted pubkey.
 *
 * This is a distribution function, not a security primitive: the salt keeps the
 * assignment unpredictable to an outside observer, and nothing about the scheme
 * depends on the hash being collision-resistant.
 */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Index of the relay assigned to `pubkey`, stable while the relay list and the
 * salt are unchanged.
 */
export function assignRelayIndex(
  pubkey: string,
  salt: string,
  relayCount: number
): number {
  if (relayCount <= 0) {
    return -1;
  }
  return hash32(`${salt}:${pubkey}`) % relayCount;
}

/**
 * Relay assigned to `pubkey`, or null when no relay is configured.
 */
export function assignRelay(
  pubkey: string,
  salt: string,
  relays: string[]
): string | null {
  const index = assignRelayIndex(pubkey, salt, relays.length);
  return index < 0 ? null : relays[index];
}

/**
 * The single permitted failover relay for `pubkey`.
 *
 * Background hydration retries a failed assignment on exactly one alternate,
 * never on the whole list: broadcasting the identity set on failure would undo
 * the partition it just paid for.
 */
export function alternateRelay(
  pubkey: string,
  salt: string,
  relays: string[]
): string | null {
  if (relays.length < 2) {
    return null;
  }
  const index = assignRelayIndex(pubkey, salt, relays.length);
  return relays[(index + 1) % relays.length];
}

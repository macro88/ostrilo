/**
 * The NIP-01 event id pre-image. One implementation, no dependencies.
 *
 * This module produces the string that gets hashed and nothing else: no
 * hashing, no hex, no signing, no crypto library, no browser API. That is the
 * point - it is the highest-consequence string in the product, and it must be
 * callable in a unit test with no adapter, port or mock so the vectors can
 * pin it directly.
 */

/** The event fields NIP-01 covers with the id. Nothing else is serialized. */
export interface EventIdFields {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/**
 * Returns the NIP-01 pre-image: `[0, pubkey, created_at, kind, tags, content]`.
 *
 * ## Why this is `JSON.stringify` and not hand-rolled escaping
 *
 * NIP-01 mandates escaping exactly seven characters - line break, double quote,
 * backslash, carriage return, tab, backspace, form feed - and says no other
 * character should be escaped. Measured against that, `JSON.stringify`:
 *
 *   - escapes those seven exactly as required;
 *   - emits `U+2028`, `U+2029` and `U+007F` raw, which the spec also requires;
 *   - escapes `U+0001`-`U+001F` as `\u00XX`, which diverges from the letter of
 *     the spec but matches what most other Nostr implementations emit, because
 *     they also delegate to their language's JSON serializer;
 *   - escapes a lone surrogate as `\ud800`, which is the one genuine
 *     interoperability divergence.
 *
 * The lone-surrogate case is closed at the validation boundary instead:
 * `UnsignedEventSchema` rejects any event whose `content` or `tags` are not
 * well-formed UTF-16, so an unpaired code unit never reaches this function.
 *
 * That leaves the control-character divergence, and implementing the spec's
 * letter there would make Ostrilo WORSE on interoperability, not better: it
 * would emit `U+0001`-`U+001F` raw and disagree with the majority of the
 * ecosystem whose events Ostrilo has to verify against. Forty lines of
 * hand-rolled escaping in the function that decides what gets signed is also a
 * poor trade against a serializer the whole ecosystem already agrees on.
 *
 * So `JSON.stringify` is a decision, not an oversight. If the ecosystem ever
 * converges on the spec's letter, this one function is the only thing that
 * changes.
 */
export function serializeEventForId(
  pubkey: string,
  created_at: number,
  kind: number,
  tags: string[][],
  content: string
): string {
  return JSON.stringify([0, pubkey, created_at, kind, tags, content]);
}

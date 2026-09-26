/**
 * One implementation per cryptographic primitive.
 *
 * This is the second half of the enforcement that `eslint.config.js` starts.
 * The lint rule catches a module OUTSIDE `src/infrastructure/crypto/` importing
 * a cryptographic library. It cannot catch a SECOND adapter added inside that
 * directory, where the import is legitimate - and duplicated adapters are how
 * this codebase got here in the first place.
 *
 * Detection is by import edge wherever an import exists: the set of `src/`
 * modules importing a given library symbol must have exactly one member, and
 * that member must be the expected adapter. Two primitives have no library
 * import to key on - AES-GCM comes from WebCrypto, and the hex codec and the
 * NIP-01 pre-image are plain JavaScript - so those are matched on the
 * expression that implements them, and that weakness is named in each case
 * rather than hidden.
 *
 * Every failure message lists the primitive and every file implementing it, so
 * a failure says what to go and look at.
 */

import { describe, it, expect } from "vitest";
import { SRC, collectSources } from "../helpers/source-scan";

const sources = collectSources(SRC);

/**
 * Modules whose import statements name `specifier` and bind `symbol`.
 *
 * Deliberately not a search for the function NAME anywhere in the file: a
 * comment mentioning `sha256`, or a local variable of the same name, is not a
 * second implementation, and a check that cannot tell the difference gets
 * disabled the first time it cries wolf.
 */
function importersOf(specifier: string, symbol: string): string[] {
  const pattern = new RegExp(
    String.raw`import\s*\{[^}]*\b${symbol}\b[^}]*\}\s*from\s*["']${specifier.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}["']`
  );
  return sources.filter((f) => pattern.test(f.code)).map((f) => f.path);
}

function filesMatching(pattern: RegExp): string[] {
  return sources.filter((f) => pattern.test(f.code)).map((f) => f.path);
}

function expectExactlyOne(
  primitive: string,
  files: string[],
  expected: string
): void {
  expect(
    files,
    files.length === 0
      ? `No implementation of ${primitive} found in src/. Either it moved, or this check has stopped detecting it - both need investigating.`
      : `${primitive} must have exactly one implementation in src/. Found ${
          files.length
        }: ${files.join(", ")}. The expected one is ${expected}.`
  ).toEqual([expected]);
}

const ADAPTERS = "src/infrastructure/crypto/adapters.ts";

describe("one implementation per cryptographic primitive", () => {
  it("finds the source tree it is supposed to be checking", () => {
    // Without this, a broken path turns every assertion below into a vacuous
    // pass over an empty file list.
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.map((f) => f.path)).toContain(ADAPTERS);
  });

  it("has one Schnorr implementation: signing, verification and public-key derivation", () => {
    expectExactlyOne(
      "Schnorr (@noble/curves secp256k1)",
      importersOf("@noble/curves/secp256k1.js", "schnorr"),
      ADAPTERS
    );
  });

  it("has one SHA-256 implementation", () => {
    expectExactlyOne(
      "SHA-256 (@noble/hashes)",
      importersOf("@noble/hashes/sha2.js", "sha256"),
      ADAPTERS
    );
  });

  it("has one Argon2id implementation", () => {
    expectExactlyOne(
      "Argon2id (@noble/hashes)",
      importersOf("@noble/hashes/argon2.js", "argon2idAsync"),
      ADAPTERS
    );
  });

  it("has one PBKDF2 implementation", () => {
    expectExactlyOne(
      "PBKDF2 (@noble/hashes)",
      importersOf("@noble/hashes/pbkdf2.js", "pbkdf2"),
      ADAPTERS
    );
  });

  it("has one bech32 implementation", () => {
    expectExactlyOne(
      "bech32 (@scure/base)",
      importersOf("@scure/base", "bech32"),
      ADAPTERS
    );
  });

  it("has one AES-GCM implementation", () => {
    // No import edge to key on: AES-GCM is WebCrypto, reached through a global.
    // Matched on the call instead, which is weaker - a module could wrap
    // `crypto.subtle` indirectly and slip past.
    expectExactlyOne(
      "AES-GCM (crypto.subtle)",
      filesMatching(/crypto\.subtle\.(encrypt|decrypt)\(/),
      ADAPTERS
    );
  });

  it("has one hex encoder", () => {
    // Also no import edge. `b.toString(16).padStart(2, "0")` is the byte-to-hex
    // idiom, and it was written out by hand in six places across three files.
    expectExactlyOne(
      "hex encoding",
      filesMatching(/toString\(16\)\.padStart\(2,/),
      "src/domain/utils/hex.ts"
    );
  });

  it("has one hex decoder", () => {
    // The decode idiom: `parseInt` at radix 16. The dangerous version of this
    // loop assigned `NaN` into a `Uint8Array`, which stores 0, so a malformed
    // key decoded to zero bytes in silence.
    //
    // `parseInt` at any other radix is not a hex decoder, so the radix is part
    // of the pattern; a `parseInt(kind)` in a settings component is correctly
    // not matched.
    expectExactlyOne(
      "hex decoding",
      filesMatching(/parseInt\([\s\S]{0,80}?,\s*16\)/),
      "src/domain/utils/hex.ts"
    );
  });

  it("has one NIP-01 pre-image serializer", () => {
    expectExactlyOne(
      "NIP-01 event id pre-image",
      filesMatching(/JSON\.stringify\(\[\s*0,/),
      "src/domain/nostr/event-serialization.ts"
    );
  });

  it("has one private-key parser", () => {
    // Keyed on the error code the parser throws, which only its own
    // implementation contains.
    expectExactlyOne(
      "private-key parsing",
      filesMatching(/invalid_private_key_format/),
      "src/application/crypto/private-key.ts"
    );
  });
});

describe("cryptographic libraries stay in the adapter layer", () => {
  it("has no @noble or @scure import outside src/infrastructure/crypto/", () => {
    const offenders = sources
      .filter((f) => !f.path.startsWith("src/infrastructure/crypto/"))
      .filter((f) => /from\s*["']@(noble|scure)\//.test(f.text))
      .map((f) => f.path);

    expect(
      offenders,
      `These modules import a cryptographic library directly: ${offenders.join(
        ", "
      )}. Declare a port in src/application/ports/crypto.ts instead.`
    ).toEqual([]);
  });

  it("has no cryptographic library import anywhere under src/ui/", () => {
    // Called out separately because the UI runs outside the background context
    // and must never be the place a key is encoded or decoded. The key list did
    // exactly that until this change: `publicKeyToBech32(hexToBytes(pubkey))`
    // inside a React render.
    const offenders = sources
      .filter((f) => f.path.startsWith("src/ui/"))
      .filter((f) => /from\s*["']@(noble|scure)\//.test(f.text))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });
});

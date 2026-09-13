/**
 * BIP-340 known-answer tests against the official vector file.
 *
 * Why this file exists: `tests/unit/domain/nostr-events.test.ts` signs with
 * Ostrilo and then verifies with Ostrilo. That passes for a wrong-but-consistent
 * implementation. These vectors come from outside this repository - they are the
 * authoritative BIP-340 vectors from `bitcoin/bips`, vendored verbatim - so they
 * can distinguish "correct" from "self-consistent".
 *
 * The vector file is loaded through `tests/vectors/load.ts`, which asserts its
 * recorded SHA-256 first. If someone edits a vector, the load fails loudly
 * rather than the expectations quietly moving to match.
 *
 * Nothing here is mocked. Every assertion runs real code from
 * `src/domain/utils/crypto.ts` over real curve arithmetic.
 *
 * ## A note on the two verification entry points
 *
 * `verifyEventSignature` is the Nostr-shaped API: its message is a hex event id,
 * which is always exactly 32 bytes. Vectors 15-18 were added upstream in 2022 to
 * cover variable-length messages (0, 1, 17 and 100 bytes), which that API cannot
 * express. Those four run through `verifySignature`, the byte-level entry point
 * in the same module, and the 32-byte-message behaviour of `verifyEventSignature`
 * is pinned separately below. Both are Ostrilo's own code; neither is a stand-in.
 *
 * ## Why the invalid vectors fail (upstream's own reasons)
 *
 *   5  public key not on the curve
 *   6  has_even_y(R) is false
 *   7  negated message
 *   8  negated s value
 *   9  sG - eP is infinite, with x(inf) taken as 0
 *   10 sG - eP is infinite, with x(inf) taken as 1
 *   11 sig[0:32] is not an X coordinate on the curve
 *   12 sig[0:32] is equal to the field size
 *   13 sig[32:64] is equal to the curve order
 *   14 public key is not a valid X coordinate - it exceeds the field size
 *
 * Each reason is carried in the vector file and is asserted present below, and
 * each appears in its test's name so a failure says which property broke.
 */

import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  getPublicKey,
  publicKeyToHex,
  signEventHash,
  signHash,
  verifyEventSignature,
  verifySignature,
} from "@/domain/utils/crypto";
import {
  bytesToHex,
  hexToBytes,
  loadBip340Vectors,
  provenance,
  type Bip340Vector,
} from "../vectors/load";

const vectors = loadBip340Vectors();

const validVectors = vectors.filter((v) => v.expectedValid);
const invalidVectors = vectors.filter((v) => !v.expectedValid);
const signingVectors = vectors.filter((v) => v.secretKey !== null);
const fixedLengthVectors = vectors.filter((v) => v.messageIs32Bytes);
const variableLengthVectors = vectors.filter((v) => !v.messageIs32Bytes);

/** Names a vector in a test title so a failure identifies the exact row. */
function title(v: Bip340Vector): string {
  const reason = v.comment ? ` - ${v.comment}` : "";
  return `vector ${v.index} (${v.expectedValid ? "valid" : "invalid"})${reason}`;
}

describe("BIP-340 official test vectors", () => {
  describe("vector file", () => {
    it("is the official file, loaded with its provenance and checksum verified", () => {
      const recorded = provenance["bip340-schnorr.csv"];
      expect(recorded).toBeDefined();
      expect(recorded!.official).toBe(true);
      expect(recorded!.upstream_url).toBe(
        "https://raw.githubusercontent.com/bitcoin/bips/master/bip-0340/test-vectors.csv"
      );
      // loadBip340Vectors() already threw if the SHA-256 did not match.
      expect(recorded!.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("holds the expected 19 vectors, 9 valid and 10 invalid", () => {
      expect(vectors).toHaveLength(19);
      expect(validVectors).toHaveLength(9);
      expect(invalidVectors).toHaveLength(10);
      expect(vectors.map((v) => v.index)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
      ]);
    });

    it("documents a failure reason for every invalid vector", () => {
      expect(invalidVectors.map((v) => v.index)).toEqual([
        5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      ]);
      for (const v of invalidVectors) {
        expect(
          v.comment.length,
          `invalid vector ${v.index} has no recorded reason for failing`
        ).toBeGreaterThan(0);
      }
    });

    it("splits into 15 fixed-length and 4 variable-length message vectors", () => {
      // Vectors 15-18 were added upstream in 2022 for variable-length messages.
      // If a refresh changes this split, the routing below must be revisited.
      expect(fixedLengthVectors).toHaveLength(15);
      expect(variableLengthVectors.map((v) => v.index)).toEqual([
        15, 16, 17, 18,
      ]);
    });
  });

  // Task 4.6 - every valid and invalid vector through Ostrilo's verification.
  describe("verification through Ostrilo's own verifier", () => {
    for (const v of vectors) {
      it(`agrees with ${title(v)}`, () => {
        const actual = verifySignature(
          hexToBytes(v.signature),
          hexToBytes(v.message),
          hexToBytes(v.publicKey)
        );
        expect(
          actual,
          v.expectedValid
            ? `vector ${v.index} must verify but Ostrilo rejected it`
            : `vector ${v.index} must be rejected (${v.comment}) but Ostrilo accepted it`
        ).toBe(v.expectedValid);
      });
    }

    for (const v of fixedLengthVectors) {
      it(`agrees via verifyEventSignature with ${title(v)}`, () => {
        const actual = verifyEventSignature(
          v.message,
          v.signature,
          v.publicKey
        );
        expect(
          actual,
          v.expectedValid
            ? `vector ${v.index} must verify through verifyEventSignature`
            : `vector ${v.index} must be rejected (${v.comment}) by verifyEventSignature`
        ).toBe(v.expectedValid);
      });
    }

    it("reports variable-length-message vectors as invalid, because verifyEventSignature only accepts a 32-byte event id", () => {
      // Pinned, not celebrated. `verifyEventSignature` reads exactly 32 bytes of
      // hex, so a 0-, 1-, 17- or 100-byte BIP-340 message is outside its domain
      // and it fails closed. That is the right direction to fail in for a Nostr
      // signer, where the message is always an event id, but it means these four
      // vectors are only meaningfully covered by `verifySignature` above.
      for (const v of variableLengthVectors) {
        expect(v.expectedValid).toBe(true);
        expect(
          verifyEventSignature(v.message, v.signature, v.publicKey),
          `vector ${v.index} should fail closed through the 32-byte-message API`
        ).toBe(false);
      }
    });
  });

  // Task 4.7 - byte-exact reproduction of the published signatures.
  describe("signing reproduces the published signatures byte for byte", () => {
    // Ostrilo's own signer CANNOT be used for this check. `signEventHash` and
    // `signHash` call `schnorr.sign(message, privateKey)` with no third
    // argument, so @noble draws fresh auxiliary randomness internally. BIP-340
    // signatures are only deterministic for a *given* aux_rand, so Ostrilo's
    // signer produces a different (equally valid) signature every call and can
    // never reproduce a fixed published one. Feeding each vector's aux_rand to
    // `schnorr.sign` directly is the only way to test byte-exact reproduction,
    // and it tests the exact primitive Ostrilo signs with - the same
    // `@noble/curves` `schnorr` import that `src/domain/utils/crypto.ts` uses.
    //
    // The complementary check - that Ostrilo's own signer produces signatures
    // that verify against the vector public key and message - is the next
    // describe block. Neither substitutes for the other, which is why both are
    // here and separately named.
    it("has 8 vectors carrying a secret key and auxiliary randomness", () => {
      expect(signingVectors.map((v) => v.index)).toEqual([
        0, 1, 2, 3, 15, 16, 17, 18,
      ]);
      for (const v of signingVectors) {
        expect(v.auxRand).not.toBeNull();
      }
    });

    for (const v of signingVectors) {
      it(`reproduces the signature for ${title(v)}`, () => {
        const signature = schnorr.sign(
          hexToBytes(v.message),
          hexToBytes(v.secretKey!),
          hexToBytes(v.auxRand!)
        );
        expect(
          bytesToHex(signature),
          `vector ${v.index} did not reproduce byte for byte with its published aux_rand`
        ).toBe(v.signature);
      });
    }
  });

  // Task 4.8 - Ostrilo's own signer, checked for what it can be checked for.
  describe("Ostrilo's own signer produces signatures that verify", () => {
    const ownSignerVectors = signingVectors.filter((v) => v.messageIs32Bytes);

    it("covers the 4 vectors whose message is a 32-byte event id", () => {
      expect(ownSignerVectors.map((v) => v.index)).toEqual([0, 1, 2, 3]);
    });

    for (const v of ownSignerVectors) {
      it(`signEventHash output verifies against the published public key for ${title(v)}`, () => {
        const produced = signEventHash(v.message, hexToBytes(v.secretKey!));

        expect(produced).toMatch(/^[0-9a-f]{128}$/);
        // Fresh auxiliary randomness, so this is a different signature from the
        // published one - and it must still verify against the vector's key.
        expect(
          verifyEventSignature(v.message, produced, v.publicKey),
          `Ostrilo's signature for vector ${v.index} does not verify against the published public key`
        ).toBe(true);
      });

      it(`signHash output verifies against the published public key for ${title(v)}`, () => {
        const produced = signHash(
          hexToBytes(v.message),
          hexToBytes(v.secretKey!)
        );

        expect(produced).toHaveLength(64);
        expect(
          verifySignature(
            produced,
            hexToBytes(v.message),
            hexToBytes(v.publicKey)
          ),
          `Ostrilo's signature for vector ${v.index} does not verify against the published public key`
        ).toBe(true);
      });

      it(`does not reproduce the published signature for ${title(v)}, because it draws its own auxiliary randomness`, () => {
        // This is the reason the previous describe block cannot use Ostrilo's
        // signer. Asserted rather than merely claimed in a comment.
        const first = signEventHash(v.message, hexToBytes(v.secretKey!));
        const second = signEventHash(v.message, hexToBytes(v.secretKey!));
        expect(first).not.toBe(second);
        expect(first).not.toBe(v.signature);
      });
    }

    it("rejects a message that is not 32 bytes rather than truncating or padding it", () => {
      // Fails closed: the variable-length vectors cannot be signed through
      // Ostrilo's API at all, and that is better than silently signing the
      // wrong 32 bytes.
      for (const v of variableLengthVectors) {
        expect(() =>
          signHash(hexToBytes(v.message), hexToBytes(v.secretKey!))
        ).toThrow(/32 bytes/);
      }
    });
  });

  // Task 4.9 - public key derivation.
  describe("public key derivation matches the vectors", () => {
    for (const v of signingVectors) {
      it(`derives the published x-only public key for ${title(v)}`, () => {
        const derived = getPublicKey(hexToBytes(v.secretKey!));

        expect(derived).toHaveLength(33); // compressed SEC1
        expect(
          publicKeyToHex(derived),
          `vector ${v.index} derived the wrong x-only public key`
        ).toBe(v.publicKey);
      });
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  verifierAad,
  dekAad,
  skAad,
  AAD_DOMAIN,
} from "@/domain/crypto/aad";
import type { KdfParams } from "@/domain/types";

const argon: KdfParams = {
  alg: "argon2id",
  m: 19456,
  t: 2,
  p: 1,
  salt: [1, 2, 3, 4],
};
const pbkdf2: KdfParams = { alg: "pbkdf2-sha256", c: 600_000, salt: [1, 2, 3, 4] };

const hex = (u: Uint8Array) =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const KEY_ID = "11111111-2222-3333-4444-555555555555";
const PUBKEY = "ab".repeat(32);

describe("AAD encoder", () => {
  describe("byte stability", () => {
    it("produces identical bytes for identical inputs", () => {
      expect(hex(verifierAad(1, argon))).toBe(hex(verifierAad(1, argon)));
      expect(hex(dekAad(1, argon, KEY_ID, PUBKEY))).toBe(
        hex(dekAad(1, argon, KEY_ID, PUBKEY))
      );
      expect(hex(skAad(1, KEY_ID, PUBKEY))).toBe(hex(skAad(1, KEY_ID, PUBKEY)));
    });

    it("does not depend on object key order", () => {
      // A JSON-based encoder would be at the mercy of property order. This one
      // reads fields explicitly, so a differently-ordered literal is identical.
      const reordered = {
        salt: [1, 2, 3, 4],
        p: 1,
        t: 2,
        m: 19456,
        alg: "argon2id",
      } as KdfParams;
      expect(hex(verifierAad(1, reordered))).toBe(hex(verifierAad(1, argon)));
    });
  });

  describe("domain separation", () => {
    it("gives each use a distinct prefix", () => {
      const v = hex(verifierAad(1, argon));
      const d = hex(dekAad(1, argon, KEY_ID, PUBKEY));
      const s = hex(skAad(1, KEY_ID, PUBKEY));
      expect(new Set([v, d, s]).size).toBe(3);
    });

    it("never lets one domain's AAD equal another's", () => {
      // Same everything except the domain: the blobs must not be interchangeable.
      expect(hex(dekAad(1, argon, KEY_ID, PUBKEY))).not.toBe(
        hex(skAad(1, KEY_ID, PUBKEY))
      );
      expect(Object.values(AAD_DOMAIN)).toHaveLength(3);
      expect(new Set(Object.values(AAD_DOMAIN)).size).toBe(3);
    });
  });

  describe("every single-field change alters the output", () => {
    it("version", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(hex(verifierAad(2, argon)));
    });

    it("algorithm", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(hex(verifierAad(1, pbkdf2)));
    });

    // These are the load-bearing ones. If a cost field were left out of the
    // AAD, an attacker who can write storage could roll the work factor back
    // to something trivially cheap and the tag would still verify.
    it("argon2id memory cost m", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(
        hex(verifierAad(1, { ...argon, m: 8 } as KdfParams))
      );
    });

    it("argon2id time cost t", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(
        hex(verifierAad(1, { ...argon, t: 1 } as KdfParams))
      );
    });

    it("argon2id parallelism p", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(
        hex(verifierAad(1, { ...argon, p: 2 } as KdfParams))
      );
    });

    it("pbkdf2 iteration count c", () => {
      expect(hex(verifierAad(1, pbkdf2))).not.toBe(
        hex(verifierAad(1, { ...pbkdf2, c: 1000 } as KdfParams))
      );
    });

    it("salt", () => {
      expect(hex(verifierAad(1, argon))).not.toBe(
        hex(verifierAad(1, { ...argon, salt: [9, 9, 9, 9] } as KdfParams))
      );
    });

    it("key id", () => {
      expect(hex(dekAad(1, argon, KEY_ID, PUBKEY))).not.toBe(
        hex(dekAad(1, argon, "other-id", PUBKEY))
      );
      expect(hex(skAad(1, KEY_ID, PUBKEY))).not.toBe(
        hex(skAad(1, "other-id", PUBKEY))
      );
    });

    it("pubkey", () => {
      // This is what stops one record's ciphertext being swapped into another.
      expect(hex(skAad(1, KEY_ID, PUBKEY))).not.toBe(
        hex(skAad(1, KEY_ID, "cd".repeat(32)))
      );
    });
  });

  describe("length prefixing prevents field-boundary confusion", () => {
    it("distinguishes ('ab','c') from ('a','bc')", () => {
      // Without length prefixes both would concatenate to the same bytes, and
      // an attacker could shift a boundary while keeping the AAD identical.
      expect(hex(skAad(1, "ab", "c"))).not.toBe(hex(skAad(1, "a", "bc")));
    });
  });

  describe("mutable metadata is excluded", () => {
    it("omits label, isSelected, createdAt and lastUsedAt", () => {
      // Renaming a key or selecting a different one must not require
      // re-encrypting anything. The encoder takes no such argument at all, so
      // the strongest statement is structural: the full AAD for a record is a
      // function of version, kdf, id and pubkey only.
      const a = hex(dekAad(1, argon, KEY_ID, PUBKEY));
      const b = hex(dekAad(1, argon, KEY_ID, PUBKEY));
      expect(a).toBe(b);

      const encoded = new TextDecoder().decode(dekAad(1, argon, KEY_ID, PUBKEY));
      for (const forbidden of ["label", "isSelected", "createdAt", "lastUsedAt"]) {
        expect(encoded).not.toContain(forbidden);
      }
    });
  });

  describe("input validation", () => {
    it("rejects a non-integer or negative version", () => {
      expect(() => verifierAad(1.5, argon)).toThrow(/aad_invalid_number/);
      expect(() => verifierAad(-1, argon)).toThrow(/aad_invalid_number/);
    });
  });
});

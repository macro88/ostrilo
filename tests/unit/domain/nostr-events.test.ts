/**
 * NIP-01 event id and signing, exercised through the surviving
 * implementations.
 *
 * Every symbol this file used to import - `computeEventId`, `signEventHash`,
 * `verifyEventSignature`, `generatePrivateKey`, `getPublicKey`,
 * `publicKeyToHex` - lived in `src/domain/utils/crypto.ts`, a second copy of
 * the product's crypto that reached `@noble/*` directly from the domain layer.
 * Two of those functions had no caller in `src/` at all, so the assertions
 * below were describing code the extension never ran.
 *
 * They now run against: the single application-layer `computeEventId` bound to
 * the SHA-256 adapter, the `Schnorr` adapter for derivation and verification,
 * and `KeyVaultService` for the end-to-end path a signature actually takes.
 */

import { describe, it, expect } from "vitest";
import { NobleSchnorr, NostrEventCrypto } from "@/infrastructure/crypto/adapters";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";
import { testVault, TEST_VAULT_PASSWORD } from "../../helpers/vault";

const PUBKEY_A =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const PUBKEY_B =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

const SECRET_KEY_A = hexToBytes(
  "0000000000000000000000000000000000000000000000000000000000000003"
);
const SECRET_KEY_B = hexToBytes(
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef"
);

function eventId(fields: {
  pubkey?: string;
  created_at?: number;
  kind?: number;
  tags?: string[][];
  content?: string;
}): string {
  return NostrEventCrypto.computeEventId({
    pubkey: fields.pubkey ?? PUBKEY_A,
    created_at: fields.created_at ?? 1234567890,
    kind: fields.kind ?? 1,
    tags: fields.tags ?? [],
    content: fields.content ?? "Hello",
  });
}

function sign(eventIdHex: string, secretKey: Uint8Array): string {
  return bytesToHex(NobleSchnorr.sign(hexToBytes(eventIdHex), secretKey));
}

describe("NIP-01 Event ID Computation", () => {
  describe("computeEventId", () => {
    it("computes a 64-character lowercase hex id for a simple text note", () => {
      const id = eventId({ content: "Hello, Nostr!" });
      expect(id).toMatch(/^[0-9a-f]{64}$/);
      expect(id.length).toBe(64);
    });

    it("produces different IDs for different content", () => {
      expect(eventId({ content: "Hello" })).not.toBe(
        eventId({ content: "World" })
      );
    });

    it("produces different IDs for different timestamps", () => {
      expect(eventId({ created_at: 1000000000 })).not.toBe(
        eventId({ created_at: 1000000001 })
      );
    });

    it("produces different IDs for different kinds", () => {
      expect(eventId({ kind: 1 })).not.toBe(eventId({ kind: 6 }));
    });

    it("produces different IDs for different pubkeys", () => {
      expect(eventId({ pubkey: PUBKEY_A })).not.toBe(
        eventId({ pubkey: PUBKEY_B })
      );
    });

    it("handles events with tags correctly", () => {
      const idEmpty = eventId({ tags: [] });
      const idWithP = eventId({ tags: [["p", PUBKEY_B]] });
      const idWithE = eventId({
        tags: [
          ["e", "abc123def456abc123def456abc123def456abc123def456abc123def456abc1"],
        ],
      });

      expect(idEmpty).not.toBe(idWithP);
      expect(idEmpty).not.toBe(idWithE);
      expect(idWithP).not.toBe(idWithE);
    });

    it("produces deterministic IDs for identical inputs", () => {
      const fields = { tags: [["t", "nostr"]], content: "Test determinism" };
      expect(eventId(fields)).toBe(eventId(fields));
    });

    it("handles empty content correctly", () => {
      expect(eventId({ content: "" })).toMatch(/^[0-9a-f]{64}$/);
    });

    it("handles special characters in content", () => {
      const content = '{"json": true, "emoji": "🎉", "unicode": "日本語"}';
      expect(eventId({ content })).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("Schnorr signing through the adapter", () => {
    it("produces valid 128-character hex signatures", () => {
      const signature = sign(PUBKEY_A, SECRET_KEY_A);
      expect(signature).toMatch(/^[0-9a-f]{128}$/);
      expect(signature.length).toBe(128);
    });

    it("produces different signatures for different event IDs", () => {
      expect(sign(PUBKEY_A, SECRET_KEY_A)).not.toBe(
        sign(PUBKEY_B, SECRET_KEY_A)
      );
    });
  });

  describe("verifyEventSignature", () => {
    it("verifies valid signatures", () => {
      const pubkeyHex = bytesToHex(NobleSchnorr.getPublicKey(SECRET_KEY_A));
      const signature = sign(PUBKEY_A, SECRET_KEY_A);

      expect(
        NostrEventCrypto.verifyEventSignature(PUBKEY_A, signature, pubkeyHex)
      ).toBe(true);
    });

    it("rejects signatures with wrong event ID", () => {
      const pubkeyHex = bytesToHex(NobleSchnorr.getPublicKey(SECRET_KEY_A));
      const signature = sign(PUBKEY_A, SECRET_KEY_A);

      expect(
        NostrEventCrypto.verifyEventSignature(PUBKEY_B, signature, pubkeyHex)
      ).toBe(false);
    });

    it("rejects signatures with wrong public key", () => {
      const otherPubkeyHex = bytesToHex(
        NobleSchnorr.getPublicKey(SECRET_KEY_B)
      );
      const signature = sign(PUBKEY_A, SECRET_KEY_A);

      expect(
        NostrEventCrypto.verifyEventSignature(
          PUBKEY_A,
          signature,
          otherPubkeyHex
        )
      ).toBe(false);
    });

    it("rejects a non-hex signature", () => {
      // Kept as a plain outcome check. It does NOT prove the hex guard: an
      // all-zero signature fails verification on the curve too, so this
      // assertion passes with or without the guard. What the guard actually
      // buys - that malformed input never reaches the curve at all - is
      // asserted in tests/security/crypto-consolidation.test.ts, where a
      // verifier double records whether it was called.
      const pubkeyHex = bytesToHex(NobleSchnorr.getPublicKey(SECRET_KEY_A));
      expect(
        NostrEventCrypto.verifyEventSignature(
          PUBKEY_A,
          "z".repeat(128),
          pubkeyHex
        )
      ).toBe(false);
    });
  });

  describe("End-to-end event signing", () => {
    it("creates and verifies a complete signed event through the vault", async () => {
      const { vault } = testVault();
      const record = await vault.generateKey(TEST_VAULT_PASSWORD, "signer");
      await vault.unlock(TEST_VAULT_PASSWORD);

      const unsigned = {
        pubkey: record.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [] as string[][],
        content: "Hello, Nostr!",
      };

      const signed = await vault.signEvent(unsigned, record.id);

      expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
      expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);

      // The returned id must be the id of the returned fields, not merely a
      // well-formed hex string: this is the property that says the extension
      // signed what it showed.
      expect(signed.id).toBe(NostrEventCrypto.computeEventId(unsigned));

      expect(
        NostrEventCrypto.verifyEventSignature(
          signed.id,
          signed.sig,
          record.pubkey
        )
      ).toBe(true);
    });
  });
});

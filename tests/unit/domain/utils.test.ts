/**
 * Domain utility tests.
 *
 * This file used to have a twin. `tests/unit/domain/domain-utils.test.ts` was a
 * 278-line near-copy covering the same modules and differing in five
 * assertions - duplicated tests for duplicated code, where a fix to one was
 * invisible in the other. They are collapsed here, keeping every assertion that
 * actually differed.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluatePasswordStrength,
  isValidPrivateKeyFormat,
  isValidPublicKeyHex,
  isValidRelayUrl,
  isValidOrigin,
} from "@/domain/utils/validation";
import { hexToBytes, bytesToHex, isValidHex } from "@/domain/utils/hex";
import { zeroize } from "@/domain/utils/memory";
import { parsePrivateKey } from "@/application/crypto/private-key";
import { CRYPTO_CONSTANTS } from "@/domain/crypto/constants";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import { NobleSchnorr, ScureBech32 } from "@/infrastructure/crypto/adapters";
import { testVault, TEST_VAULT_PASSWORD } from "../../helpers/vault";

/** A fixed secret key, so encoding assertions do not depend on a draw. */
const FIXED_SECRET_KEY = hexToBytes(
  "0101010101010101010101010101010101010101010101010101010101010101"
);

describe("Domain Utils - Validation", () => {
  describe("evaluatePasswordStrength", () => {
    // `meetsMinimum` is gone on purpose. It was the one correct predicate in
    // the codebase and nothing used it; the UI re-implemented half of it as
    // `score < 3`, which `Aa1!` satisfies. The replacement verdict cannot be
    // `acceptable` without the blocklist, so a local evaluation can report
    // violations but can never green-light a password.
    it("reports a long passphrase as having no structural violations", () => {
      const result = evaluatePasswordStrength("unmark thicket parcel");
      expect(result.violations).toEqual(["blocklist_unavailable"]);
      expect(result.blocklistChecked).toBe(false);
      expect(result.acceptable).toBe(false);
    });

    it("identifies weak passwords", () => {
      const result = evaluatePasswordStrength("weak");
      expect(result.score).toBe(0);
      expect(result.violations).toContain("too_short");
      expect(result.requirements.some((r) => !r.passes)).toBe(true);
    });

    it("rejects Aa1!, which the old score-only gate accepted", () => {
      const result = evaluatePasswordStrength("Aa1!");
      expect(result.violations).toContain("too_short");
      expect(result.acceptable).toBe(false);
    });
  });

  describe("isValidPrivateKeyFormat", () => {
    it("validates hex private keys", () => {
      const validHex = "a".repeat(64); // 32 bytes as hex
      expect(isValidPrivateKeyFormat(validHex)).toBe(true);

      const tooShort = "a".repeat(62);
      expect(isValidPrivateKeyFormat(tooShort)).toBe(false);

      const invalid = "g".repeat(64);
      expect(isValidPrivateKeyFormat(invalid)).toBe(false);
    });

    it("validates nsec private keys", () => {
      const nsec = ScureBech32.encode(
        CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX,
        FIXED_SECRET_KEY
      );
      expect(isValidPrivateKeyFormat(nsec)).toBe(true);
    });

    it("only checks that an nsec is longer than its prefix", () => {
      // Both halves of the collapsed twin files asserted this, with different
      // examples. Kept together, because the point is the weakness of the
      // check, not any one input: this is a shape test, and the real parse
      // happens in `parsePrivateKey`.
      expect(isValidPrivateKeyFormat("nsec1invalid")).toBe(true);
      expect(isValidPrivateKeyFormat("nsec1x")).toBe(true);
      expect(isValidPrivateKeyFormat("nsec1")).toBe(true);
      expect(isValidPrivateKeyFormat("nsec")).toBe(false); // exactly the prefix
    });
  });

  describe("isValidPublicKeyHex", () => {
    it("validates public key hex format", () => {
      const validPubkey = "b".repeat(64); // 32 bytes as hex
      expect(isValidPublicKeyHex(validPubkey)).toBe(true);

      const tooShort = "b".repeat(62);
      expect(isValidPublicKeyHex(tooShort)).toBe(false);

      const invalid = "z".repeat(64);
      expect(isValidPublicKeyHex(invalid)).toBe(false);
    });
  });

  describe("isValidRelayUrl", () => {
    it("accepts only secure WebSocket relay URLs", () => {
      expect(isValidRelayUrl("wss://relay.example.com")).toBe(true);
      expect(isValidRelayUrl("wss://relay.example.com/v1")).toBe(true);
      expect(isValidRelayUrl("wss://localhost:8080")).toBe(true);

      // Cleartext is refused everywhere, including localhost: there is no
      // development relay workflow, and an exemption would be a permanent hole.
      expect(isValidRelayUrl("ws://relay.example.com")).toBe(false);
      expect(isValidRelayUrl("ws://localhost:8080")).toBe(false);

      expect(isValidRelayUrl("https://example.com")).toBe(false);
      expect(isValidRelayUrl("http://example.com")).toBe(false);
      expect(isValidRelayUrl("javascript:alert(1)")).toBe(false);
      expect(isValidRelayUrl("invalid")).toBe(false);
      expect(isValidRelayUrl("")).toBe(false);
    });

    it("rejects embedded credentials and empty hostnames", () => {
      expect(isValidRelayUrl("wss://user:pass@relay.example.com")).toBe(false);
      expect(isValidRelayUrl("wss://user@relay.example.com")).toBe(false);
      expect(isValidRelayUrl("wss://")).toBe(false);
    });
  });

  describe("isValidOrigin", () => {
    it("validates web origins", () => {
      expect(isValidOrigin("https://example.com")).toBe(true);
      expect(isValidOrigin("http://localhost:3000")).toBe(true);

      expect(isValidOrigin("invalid")).toBe(false);
      expect(isValidOrigin("file://")).toBe(false);
    });
  });
});

describe("Domain Utils - Hex codec", () => {
  describe("hexToBytes/bytesToHex", () => {
    it("converts hex to bytes and back", () => {
      const hex = "deadbeef";
      const bytes = hexToBytes(hex);
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);

      const hexBack = bytesToHex(bytes);
      expect(hexBack).toBe(hex);
    });

    it("accepts uppercase hex and always emits lowercase", () => {
      const bytes = hexToBytes("DEADBEEF");
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
      expect(bytesToHex(bytes)).toBe("deadbeef");
    });

    // The assertion that used to stand here was
    // `expect(() => hexToBytes("invalid")).toThrow()`, which looks like
    // coverage of malformed input and is not: "invalid" has seven characters,
    // so it only ever tripped the odd-length branch. No test in either twin
    // file passed even-length non-hex input, which is exactly the input the
    // old decoder got wrong. The two cases are separated here so neither can
    // stand in for the other.
    it("rejects odd-length input, naming the length", () => {
      expect(() => hexToBytes("deadbee")).toThrow(/length/i);
    });

    it("rejects even-length non-hex input, naming the characters", () => {
      expect(() => hexToBytes("zzzz")).toThrow(/non-hexadecimal/i);
      expect(() => hexToBytes("gg")).toThrow(/non-hexadecimal/i);
    });

    it("rejects partially malformed input without returning a partial result", () => {
      // The old decoder would have returned [0xde, 0xad, 0x00, 0x00] here:
      // `parseInt("zz", 16)` is NaN, and NaN stored into a Uint8Array is 0.
      expect(() => hexToBytes("deadzzzz")).toThrow(/non-hexadecimal/i);
    });
  });

  describe("isValidHex", () => {
    it("validates hex strings", () => {
      expect(isValidHex("deadbeef")).toBe(true);
      expect(isValidHex("DEADBEEF")).toBe(true);
      expect(isValidHex("1234567890abcdef")).toBe(true);
      expect(isValidHex("")).toBe(false); // empty is not valid

      expect(isValidHex("invalid")).toBe(false);
      expect(isValidHex("deadbeeg")).toBe(false); // invalid char
    });

    it("rejects odd length, unlike the codec it replaces", () => {
      // BEHAVIOUR CHANGE, deliberate. The old `isValidHex` tested only
      // `^[0-9a-fA-F]+$`, so it reported an odd-length string as valid while
      // `hexToBytes` threw on it. A predicate that disagrees with the decoder
      // it guards is worse than no predicate.
      expect(isValidHex("deadbee")).toBe(false);
    });

    it("validates hex with an expected byte length", () => {
      expect(isValidHex("deadbeef", 4)).toBe(true);
      expect(isValidHex("deadbeef", 3)).toBe(false);
    });
  });
});

describe("Domain Utils - Nostr key encoding", () => {
  it("encodes and decodes bech32 through the single codec", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = ScureBech32.encode("test", data);
    expect(encoded).toMatch(/^test1/);

    const decoded = ScureBech32.decode(encoded);
    expect(decoded.prefix).toBe("test");
    expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects malformed bech32 rather than returning a value", () => {
    expect(() => ScureBech32.decode("invalid")).toThrow();
  });

  it("converts a public key to npub format", () => {
    const pub = NobleSchnorr.getPublicKey(FIXED_SECRET_KEY);
    const npub = ScureBech32.encode(
      CRYPTO_CONSTANTS.NOSTR_PUBLIC_KEY_PREFIX,
      pub
    );
    expect(npub).toMatch(/^npub1/);
    expect(npub.length).toBeGreaterThan(60);
  });

  it("converts a private key to nsec format", () => {
    const nsec = ScureBech32.encode(
      CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX,
      FIXED_SECRET_KEY
    );
    expect(nsec).toMatch(/^nsec1/);
    expect(nsec.length).toBeGreaterThan(60);
  });

  it("parses private keys from hex and from nsec, through one parser", () => {
    const hex = bytesToHex(FIXED_SECRET_KEY);
    const nsec = ScureBech32.encode(
      CRYPTO_CONSTANTS.NOSTR_PRIVATE_KEY_PREFIX,
      FIXED_SECRET_KEY
    );

    expect(Array.from(parsePrivateKey(ScureBech32, hex))).toEqual(
      Array.from(FIXED_SECRET_KEY)
    );
    expect(Array.from(parsePrivateKey(ScureBech32, nsec))).toEqual(
      Array.from(FIXED_SECRET_KEY)
    );
  });
});

describe("Domain Utils - Key material", () => {
  // These used to exercise `generatePrivateKey`, `getPublicKey` and
  // `generateKeyPair` from `domain/utils/crypto.ts` - a second generator that
  // no module in `src/` ever called. Asserting properties of an implementation
  // the product does not run proves nothing about the product, so they point
  // at the generator the vault actually uses.
  let svc: KeyVaultService;

  beforeEach(() => {
    svc = testVault().vault;
  });

  it("generates a key whose stored pubkey is 32 bytes of hex", async () => {
    const record = await svc.generateKey(TEST_VAULT_PASSWORD, "first");
    expect(record.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different key each time", async () => {
    const first = await svc.generateKey(TEST_VAULT_PASSWORD, "first");
    const second = await svc.generateKey(TEST_VAULT_PASSWORD, "second");
    expect(first.pubkey).not.toBe(second.pubkey);
  });

  describe("public key derivation", () => {
    it("derives a 32-byte x-only public key", () => {
      const publicKey = NobleSchnorr.getPublicKey(FIXED_SECRET_KEY);
      // BIP-340 keys are x-only. The deleted `getPublicKey` returned a 33-byte
      // compressed SEC1 key and every caller sliced the parity byte back off.
      expect(publicKey.length).toBe(32);
    });

    it("produces consistent results", () => {
      const pubkey1 = NobleSchnorr.getPublicKey(FIXED_SECRET_KEY);
      const pubkey2 = NobleSchnorr.getPublicKey(FIXED_SECRET_KEY);
      expect(Array.from(pubkey1)).toEqual(Array.from(pubkey2));
    });
  });

  describe("zeroize", () => {
    it("zeros out arrays", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      zeroize(data);
      expect(Array.from(data)).toEqual([0, 0, 0, 0, 0]);
    });

    it("handles empty arrays", () => {
      const data = new Uint8Array(0);
      expect(() => zeroize(data)).not.toThrow();
    });
  });
});

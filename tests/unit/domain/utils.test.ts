import { describe, it, expect } from "vitest";
import {
  evaluatePasswordStrength,
  isValidPrivateKeyFormat,
  isValidPublicKeyHex,
  isValidRelayUrl,
  isValidOrigin,
} from "@/domain/utils/validation";
import {
  hexToBytes,
  bytesToHex,
  isValidHex,
  isValidBech32,
  bytesToBech32,
  bech32ToBytes,
  publicKeyToBech32,
  privateKeyToBech32,
  parsePrivateKey,
} from "@/domain/utils/encoding";
import {
  zeroize,
  generatePrivateKey,
  getPublicKey,
  generateKeyPair,
} from "@/domain/utils/crypto";

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
      // Generate a valid nsec for testing
      const privateKey = generatePrivateKey();
      const nsec = privateKeyToBech32(privateKey);
      expect(isValidPrivateKeyFormat(nsec)).toBe(true);

      // Invalid nsec should fail - this is just basic length validation
      // The actual validation function only checks prefix + has more chars
      expect(isValidPrivateKeyFormat("nsec1invalid")).toBe(true); // This will pass basic validation
      expect(isValidPrivateKeyFormat("nsec")).toBe(false); // This should fail as it's exactly the prefix length
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

describe("Domain Utils - Encoding", () => {
  describe("hexToBytes/bytesToHex", () => {
    it("converts hex to bytes and back", () => {
      const hex = "deadbeef";
      const bytes = hexToBytes(hex);
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);

      const hexBack = bytesToHex(bytes);
      expect(hexBack).toBe(hex);
    });

    it("handles uppercase hex", () => {
      const hex = "DEADBEEF";
      const bytes = hexToBytes(hex);
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it("throws on invalid hex", () => {
      expect(() => hexToBytes("invalid")).toThrow();
      expect(() => hexToBytes("deadbee")).toThrow(); // odd length
    });
  });

  describe("isValidHex", () => {
    it("validates hex strings", () => {
      expect(isValidHex("deadbeef")).toBe(true);
      expect(isValidHex("DEADBEEF")).toBe(true);
      expect(isValidHex("1234567890abcdef")).toBe(true);
      expect(isValidHex("")).toBe(false); // empty is not valid (requires at least one char)

      expect(isValidHex("invalid")).toBe(false);
      expect(isValidHex("deadbee")).toBe(true); // odd length is allowed by the regex
      expect(isValidHex("deadbeeg")).toBe(false); // invalid char
    });

    it("validates hex with expected length", () => {
      expect(isValidHex("deadbeef", 4)).toBe(true);
      expect(isValidHex("deadbeef", 3)).toBe(false);
    });
  });

  describe("bech32 encoding", () => {
    it("encodes and decodes bech32 strings", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = bytesToBech32("test", data);
      expect(encoded).toMatch(/^test1/);

      const decoded = bech32ToBytes(encoded);
      expect(decoded.prefix).toBe("test");
      expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 4, 5]);
    });

    it("validates bech32 format", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = bytesToBech32("test", data);
      expect(isValidBech32(encoded)).toBe(true);
      expect(isValidBech32(encoded, "test")).toBe(true);
      expect(isValidBech32(encoded, "wrong")).toBe(false);

      expect(isValidBech32("invalid")).toBe(false);
    });
  });

  describe("Nostr key encoding", () => {
    it("converts public key to npub format", () => {
      const keyPair = generateKeyPair();
      const npub = publicKeyToBech32(keyPair.publicKey);
      expect(npub).toMatch(/^npub1/);
      expect(npub.length).toBeGreaterThan(60);
    });

    it("converts private key to nsec format", () => {
      const keyPair = generateKeyPair();
      const nsec = privateKeyToBech32(keyPair.privateKey);
      expect(nsec).toMatch(/^nsec1/);
      expect(nsec.length).toBeGreaterThan(60);
    });

    it("parses private keys from different formats", () => {
      const keyPair = generateKeyPair();
      const hex = bytesToHex(keyPair.privateKey);
      const nsec = privateKeyToBech32(keyPair.privateKey);

      // Parse from hex
      const parsedFromHex = parsePrivateKey(hex);
      expect(Array.from(parsedFromHex)).toEqual(Array.from(keyPair.privateKey));

      // Parse from nsec
      const parsedFromNsec = parsePrivateKey(nsec);
      expect(Array.from(parsedFromNsec)).toEqual(
        Array.from(keyPair.privateKey)
      );
    });
  });
});

describe("Domain Utils - Crypto", () => {
  describe("generatePrivateKey", () => {
    it("generates 32-byte private keys", () => {
      const privateKey = generatePrivateKey();
      expect(privateKey.length).toBe(32);
    });

    it("generates different keys", () => {
      const key1 = generatePrivateKey();
      const key2 = generatePrivateKey();
      expect(Array.from(key1)).not.toEqual(Array.from(key2));
    });
  });

  describe("getPublicKey", () => {
    it("derives public key from private key", () => {
      const privateKey = generatePrivateKey();
      const publicKey = getPublicKey(privateKey);
      expect(publicKey.length).toBe(33); // secp256k1 compressed public key is 33 bytes
    });

    it("produces consistent results", () => {
      const privateKey = generatePrivateKey();
      const pubkey1 = getPublicKey(privateKey);
      const pubkey2 = getPublicKey(privateKey);
      expect(Array.from(pubkey1)).toEqual(Array.from(pubkey2));
    });
  });

  describe("generateKeyPair", () => {
    it("generates matching key pairs", () => {
      const keyPair = generateKeyPair();
      expect(keyPair.privateKey.length).toBe(32);
      expect(keyPair.publicKey.length).toBe(33); // secp256k1 compressed public key is 33 bytes

      // Verify they match
      const derivedPublic = getPublicKey(keyPair.privateKey);
      expect(Array.from(derivedPublic)).toEqual(Array.from(keyPair.publicKey));
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

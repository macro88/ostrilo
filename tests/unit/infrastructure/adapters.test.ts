import { describe, it, expect } from "vitest";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
  VaultHkdf,
} from "@/infrastructure/crypto/adapters";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";
import type { SecretBytes } from "@/application/ports/crypto";

describe("Crypto adapters", () => {
  it("AES-GCM encrypt/decrypt roundtrip", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = crypto.getRandomValues(new Uint8Array(64));
    const aad = new Uint8Array([1, 2, 3]);
    const key = await WebCryptoAesGcm.importKey(raw, ["encrypt", "decrypt"]);
    const ct = await WebCryptoAesGcm.encrypt(key, iv, data, aad);
    const pt = await WebCryptoAesGcm.decrypt(key, iv, ct, aad);
    expect(Array.from(pt)).toEqual(Array.from(data));
  });

  it("rejects decryption when the AAD does not match", async () => {
    // The whole point of the AAD: a ciphertext must not be usable under
    // different associated data, so a blob cannot be moved between records.
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = crypto.getRandomValues(new Uint8Array(64));
    const key = await WebCryptoAesGcm.importKey(raw, ["encrypt", "decrypt"]);
    const ct = await WebCryptoAesGcm.encrypt(
      key,
      iv,
      data,
      new Uint8Array([1, 2, 3])
    );
    await expect(
      WebCryptoAesGcm.decrypt(key, iv, ct, new Uint8Array([1, 2, 4]))
    ).rejects.toThrow();
  });

  it("derives from the recorded parameters, not a code constant", async () => {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));

    const argon = await VaultKdf.deriveKey("pw", {
      alg: "argon2id",
      m: 19456,
      t: 2,
      p: 1,
      salt,
    });
    expect(argon.length).toBe(32);

    const pb = await VaultKdf.deriveKey("pw", {
      alg: "pbkdf2-sha256",
      c: 600_000,
      salt,
    });
    expect(pb.length).toBe(32);

    // Same password and salt, different algorithm: different key.
    expect(Array.from(argon)).not.toEqual(Array.from(pb));
  });

  it("changing a recorded cost parameter changes the derived key", async () => {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)));
    const a = await VaultKdf.deriveKey("pw", {
      alg: "pbkdf2-sha256",
      c: 600_000,
      salt,
    });
    const b = await VaultKdf.deriveKey("pw", {
      alg: "pbkdf2-sha256",
      c: 700_000,
      salt,
    });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("Schnorr getPublicKey and sign produce outputs", async () => {
    const sk = crypto.getRandomValues(new Uint8Array(32));
    const pk = await NobleSchnorr.getPublicKey(sk);
    expect(pk.length).toBeGreaterThan(0);
    const h = new Uint8Array(32);
    const sig = await NobleSchnorr.sign(h, sk);
    expect(sig.length).toBeGreaterThan(0);
  });
});

describe("NobleSha256", () => {
  // Known-answer values, not round trips: a round trip would pass for any
  // stable function. These are the published SHA-256 digests.
  const vectors = [
    [
      "",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    [
      "abc",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      "The quick brown fox jumps over the lazy dog",
      "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
    ],
  ] as const;

  for (const [input, expected] of vectors) {
    it(`digests ${JSON.stringify(input).slice(0, 24)} to its published value`, () => {
      const digest = NobleSha256.sha256(new TextEncoder().encode(input));
      expect(digest).toHaveLength(32);
      expect(bytesToHex(digest)).toBe(expected);
    });
  }
});

describe("ScureBech32", () => {
  const PUBKEY = hexToBytes(
    "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
  );

  it("round-trips prefix and bytes", () => {
    const encoded = ScureBech32.encode("npub", PUBKEY);
    const decoded = ScureBech32.decode(encoded);
    expect(decoded.prefix).toBe("npub");
    expect(Array.from(decoded.bytes)).toEqual(Array.from(PUBKEY));
  });

  it("reports the prefix so a caller can detect a mismatch", () => {
    // The port returns the prefix rather than checking it, because only the
    // caller knows which one it asked for. `parsePrivateKey` is the caller that
    // rejects an `npub` where an `nsec` was expected.
    const encoded = ScureBech32.encode("nsec", PUBKEY);
    expect(ScureBech32.decode(encoded).prefix).toBe("nsec");
    expect(ScureBech32.decode(encoded).prefix).not.toBe("npub");
  });

  it("produces a different string for a different prefix over the same bytes", () => {
    expect(ScureBech32.encode("npub", PUBKEY)).not.toBe(
      ScureBech32.encode("nsec", PUBKEY)
    );
  });

  it("throws on malformed bech32 rather than returning a value", () => {
    // A codec that returned something usable for a corrupt input is the same
    // class of defect as the hex decoder this change replaced.
    for (const bad of [
      "not-bech32",
      "npub1",
      "",
      "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", // bad checksum
    ]) {
      expect(() => ScureBech32.decode(bad), `accepted ${bad}`).toThrow();
    }
  });

  it("rejects a string longer than the single length limit", () => {
    // The two encoders this replaced disagreed here - one took @scure's default
    // of 90, one passed 5000. An npub is 63 characters, so 90 is both the
    // standard bound and comfortably sufficient.
    expect(() => ScureBech32.decode(`npub1${"q".repeat(200)}`)).toThrow();
  });
});

describe("VaultHkdf", () => {
  // RFC 5869 test case 3: SHA-256, empty salt, empty info. HKDF output is a
  // prefix-stable stream, so the first 32 bytes of the 42-byte vector are the
  // 32-byte output. The derived key is not extractable, so it is compared by
  // use: what it encrypts, a key imported from the vector must decrypt.
  const IKM = "0b".repeat(22);
  const OKM_32 = "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d";
  const iv = new Uint8Array(12) as SecretBytes;
  const aad = new Uint8Array(0) as SecretBytes;
  const plaintext = new TextEncoder().encode("hkdf vector") as SecretBytes;

  it("derives the RFC 5869 key", async () => {
    const derived = await VaultHkdf.deriveAeadKey(
      hexToBytes(IKM) as SecretBytes,
      new Uint8Array(0),
      ["encrypt"]
    );
    const ct = await WebCryptoAesGcm.encrypt(derived, iv, plaintext, aad);

    const expected = await WebCryptoAesGcm.importKey(
      hexToBytes(OKM_32) as SecretBytes,
      ["decrypt"]
    );
    const pt = await WebCryptoAesGcm.decrypt(expected, iv, ct, aad);
    expect(new TextDecoder().decode(pt)).toBe("hkdf vector");
  });

  it("derives a different key for a different info", async () => {
    const one = await VaultHkdf.deriveAeadKey(
      hexToBytes(IKM) as SecretBytes,
      new TextEncoder().encode("purpose-a"),
      ["encrypt"]
    );
    const two = await VaultHkdf.deriveAeadKey(
      hexToBytes(IKM) as SecretBytes,
      new TextEncoder().encode("purpose-b"),
      ["decrypt"]
    );
    const ct = await WebCryptoAesGcm.encrypt(one, iv, plaintext, aad);
    await expect(WebCryptoAesGcm.decrypt(two, iv, ct, aad)).rejects.toThrow();
  });

  it("returns a key that cannot be exported", async () => {
    const key = await VaultHkdf.deriveAeadKey(
      hexToBytes(IKM) as SecretBytes,
      new Uint8Array(0),
      ["encrypt"]
    );
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

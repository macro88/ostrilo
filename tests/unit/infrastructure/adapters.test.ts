import { describe, it, expect } from "vitest";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";

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

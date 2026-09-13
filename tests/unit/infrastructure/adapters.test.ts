import { describe, it, expect } from "vitest";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";

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

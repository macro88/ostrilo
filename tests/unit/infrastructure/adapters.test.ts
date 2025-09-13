import { describe, it, expect } from "vitest";
import {
  WebCryptoAesGcm,
  NoblePbkdf2,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";

describe("Crypto adapters", () => {
  it("AES-GCM encrypt/decrypt roundtrip", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = crypto.getRandomValues(new Uint8Array(64));
    const key = await WebCryptoAesGcm.importKey(raw, ["encrypt", "decrypt"]);
    const ct = await WebCryptoAesGcm.encrypt(key, iv, data);
    const pt = await WebCryptoAesGcm.decrypt(key, iv, ct);
    expect(Array.from(pt)).toEqual(Array.from(data));
  });

  it("PBKDF2 derives 32-byte key", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const dk = await NoblePbkdf2.deriveKey("pw", salt);
    expect(dk.length).toBe(32);
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

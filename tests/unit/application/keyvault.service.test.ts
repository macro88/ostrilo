import { describe, it, expect, beforeEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyRecord } from "@/domain/types";

// Simple in-memory storage adapter to avoid webextension-polyfill in tests
function createMemoryStorage(): StorageSuite {
  const maps = {
    local: new Map<string, any>(),
    sync: new Map<string, any>(),
    session: new Map<string, any>(),
  };
  const make = (m: Map<string, any>) => ({
    async get<T>(key: string): Promise<T | undefined> {
      return m.get(key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      m.set(key, value);
    },
    async remove(key: string): Promise<void> {
      m.delete(key);
    },
  });
  return {
    local: make(maps.local),
    sync: make(maps.sync),
    session: make(maps.session),
  };
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(
    hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []
  );
}

describe("KeyVaultService", () => {
  let storage: StorageSuite;
  let svc: KeyVaultService;
  let keyRecord: KeyRecord;
  const password = "test-pass";

  beforeEach(async () => {
    storage = createMemoryStorage();
    // Prepare one dummy key: encrypt 32-byte private key using adapters
    const sk = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // Builds a LEGACY-shaped record (no v, no wrappedDek, PBKDF2-100k, no AAD)
    // so this suite also exercises the legacy read and migration path.
    const raw = await VaultKdf.deriveKey(password, {
      alg: "pbkdf2-sha256",
      c: 100_000,
      salt: Array.from(salt),
    });
    const key = await WebCryptoAesGcm.importKey(raw, ["encrypt"]);
    const ct = await WebCryptoAesGcm.encrypt(key, iv, sk, new Uint8Array(0));
    raw.fill(0);
    const pub = await NobleSchnorr.getPublicKey(sk);
    keyRecord = {
      id: "k1",
      pubkey: Array.from(pub)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      ct: Array.from(ct),
      iv: Array.from(iv),
      salt: Array.from(salt),
      createdAt: Date.now(),
      isSelected: true,
    } as any;
    await storage.local.set("encryptedKeys", [keyRecord]);
    await storage.sync.set("appSettings", { selectedKeyId: "k1" } as any);
    svc = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      VaultKdf,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
  });

  it("unlocks and sets lock state", async () => {
    const res = await svc.unlock(password);
    expect(res.selectedKeyId).toBe("k1");
    const lock = await svc.getLockState();
    expect(lock.isLocked).toBe(false);
    expect(lock.selectedKeyId).toBe("k1");
  });

  it("signs only when unlocked and errors when locked", async () => {
    await expect(svc.sign("00".repeat(32))).rejects.toBeTruthy();
    await svc.unlock(password);
    const out = await svc.sign("11".repeat(32));
    expect(out.sigHex.length).toBeGreaterThan(0);
    await svc.lock();
    await expect(svc.sign("11".repeat(32))).rejects.toBeTruthy();
  });
});

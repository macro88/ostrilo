import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr, NobleSha256, ScureBech32,
  deriveLegacyKeyReadOnly,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyRecord, VaultEnvelope } from "@/domain/types";
import {
  VAULT_VERSION,
  KDF_FLOORS,
  KDF_CEILINGS,
  KDF_DEFAULTS,
} from "@/domain/types";

// Some of these run a real KDF at production cost, legacy PBKDF2 at 100,000
// iterations among them. Under V8 coverage on a CI runner one such unlock
// takes 15-25s, past the 10s default, so the timeout is raised here rather
// than the cost lowered.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Security properties of the versioned vault envelope.
 *
 * The defects these fence, all present before this change:
 *
 *  - Records carried no format version and no KDF parameters, so the work
 *    factor could never be raised without guessing how an existing record was
 *    encrypted.
 *  - AES-GCM was used with no additional authenticated data, so nothing bound a
 *    ciphertext to its record. Blobs could be swapped between records and
 *    stored parameters rewritten.
 *  - Unlock never checked that a decrypted key actually derived the record's
 *    stored pubkey.
 *  - Unlock used Promise.all, so one damaged record rejected the whole vault
 *    and reported it to the user as a wrong password.
 *  - An empty vault "unlocked" successfully with any password.
 *
 * These run against the REAL adapters. The KDF is exercised through the
 * pbkdf2-sha256 variant at its floor rather than Argon2id, because Argon2id at
 * the shipping parameters costs ~600 ms per derivation and these tests derive
 * many times. The envelope logic under test is identical either way.
 */

const PASSWORD = "correct horse battery staple";

function memoryStorage(): { suite: StorageSuite; maps: Record<string, Map<string, unknown>> } {
  const maps = {
    local: new Map<string, unknown>(),
    sync: new Map<string, unknown>(),
    session: new Map<string, unknown>(),
  };
  const make = (m: Map<string, unknown>) => ({
    async get<T>(k: string): Promise<T | undefined> {
      return m.get(k) as T | undefined;
    },
    async set<T>(k: string, v: T): Promise<void> {
      m.set(k, v);
    },
    async remove(k: string): Promise<void> {
      m.delete(k);
    },
  });
  return {
    suite: {
      local: make(maps.local),
      sync: make(maps.sync),
      session: make(maps.session),
    } as StorageSuite,
    maps,
  };
}

/**
 * Forces the cheaper recorded algorithm so the suite stays fast. This is a
 * wrapper, not a weakening: the service still reads whatever the record says.
 */
const fastKdf = {
  async deriveKey(password: string, params: never) {
    const p = params as unknown as { salt: number[] };
    return VaultKdf.deriveKey(password, {
      alg: "pbkdf2-sha256",
      c: KDF_FLOORS["pbkdf2-sha256"].c,
      salt: p.salt,
    });
  },
};

function svc(storage: StorageSuite) {
  return new KeyVaultService(
    storage,
    WebCryptoAesGcm,
    fastKdf as never,
    NobleSchnorr,
    NobleSha256,
    ScureBech32
  );
}

describe("vault envelope: versioning and recorded parameters", () => {
  let storage: StorageSuite;
  let maps: Record<string, Map<string, unknown>>;
  let vault: KeyVaultService;

  beforeEach(() => {
    ({ suite: storage, maps } = memoryStorage());
    vault = svc(storage);
  });

  it("writes a versioned record and a vault envelope carrying the parameters", async () => {
    const rec = await vault.generateKey(PASSWORD, "k1");

    const stored = (maps.local.get("encryptedKeys") as KeyRecord[])[0];
    expect(stored.v).toBe(VAULT_VERSION);
    expect(stored.wrappedDek).toBeDefined();
    expect(stored.salt, "the per-record KDF salt is gone").toBeUndefined();
    expect(stored.pubkey).toBe(rec.pubkey);

    const env = maps.local.get("vaultEnvelope") as VaultEnvelope;
    expect(env.v).toBe(VAULT_VERSION);
    expect(env.kdf.alg).toBeDefined();
    expect(env.kdf.salt).toHaveLength(16);
    expect(env.verifier.ct.length).toBeGreaterThan(0);
  });

  it("refuses a vault whose recorded version is unknown", async () => {
    await vault.generateKey(PASSWORD, "k1");
    const env = maps.local.get("vaultEnvelope") as VaultEnvelope;
    maps.local.set("vaultEnvelope", { ...env, v: 99 });

    await expect(vault.unlock(PASSWORD)).rejects.toThrow(
      "vault_version_unsupported"
    );
  });

  it("refuses recorded KDF parameters below the floor", async () => {
    // The attack: rewrite the stored work factor to something trivially cheap.
    await vault.generateKey(PASSWORD, "k1");
    const env = maps.local.get("vaultEnvelope") as VaultEnvelope;
    maps.local.set("vaultEnvelope", {
      ...env,
      kdf: { alg: "pbkdf2-sha256", c: 1, salt: (env.kdf as { salt: number[] }).salt },
    });

    await expect(vault.unlock(PASSWORD)).rejects.toThrow("kdf_below_floor");
  });

  it.each([
    ["argon2id memory cost", { alg: "argon2id", m: KDF_CEILINGS.argon2id.m + 1, t: 2, p: 1 }],
    ["argon2id time cost", { alg: "argon2id", m: 19456, t: KDF_CEILINGS.argon2id.t + 1, p: 1 }],
    ["argon2id parallelism", { alg: "argon2id", m: 19456, t: 2, p: KDF_CEILINGS.argon2id.p + 1 }],
    ["pbkdf2 iterations", { alg: "pbkdf2-sha256", c: KDF_CEILINGS["pbkdf2-sha256"].c + 1 }],
  ])("refuses a recorded %s above the ceiling without deriving", async (_name, kdf) => {
    // The attack: rewrite the stored work factor to something that stalls or
    // crashes the worker on every unlock.
    await vault.generateKey(PASSWORD, "k1");
    const env = maps.local.get("vaultEnvelope") as VaultEnvelope;
    maps.local.set("vaultEnvelope", {
      ...env,
      kdf: { ...kdf, salt: (env.kdf as { salt: number[] }).salt },
    });
    const derive = vi.spyOn(fastKdf, "deriveKey");

    await expect(vault.unlock(PASSWORD)).rejects.toThrow("kdf_above_ceiling");
    expect(derive).not.toHaveBeenCalled();
    derive.mockRestore();
  });

  it("ships defaults that sit inside the floors and ceilings", () => {
    expect(KDF_DEFAULTS.alg).toBe("argon2id");
    if (KDF_DEFAULTS.alg !== "argon2id") return;
    for (const param of ["m", "t", "p"] as const) {
      expect(KDF_DEFAULTS[param]).toBeGreaterThanOrEqual(KDF_FLOORS.argon2id[param]);
      expect(KDF_DEFAULTS[param]).toBeLessThanOrEqual(KDF_CEILINGS.argon2id[param]);
    }
    expect(KDF_FLOORS["pbkdf2-sha256"].c).toBeLessThan(KDF_CEILINGS["pbkdf2-sha256"].c);
  });

  it("derives once for the whole vault, not once per key", async () => {
    let derivations = 0;
    const counting = {
      async deriveKey(password: string, params: never) {
        derivations++;
        return fastKdf.deriveKey(password, params);
      },
    };
    const v2 = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      counting as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    await v2.generateKey(PASSWORD, "k1");
    await v2.importKey("11".repeat(32), PASSWORD, "k2");
    await v2.importKey("22".repeat(32), PASSWORD, "k3");

    derivations = 0;
    await v2.unlock(PASSWORD);

    expect(
      derivations,
      "unlock must cost one KDF run regardless of key count; the old design paid one per record"
    ).toBe(1);
  });
});

describe("vault envelope: AAD binds ciphertext to its record", () => {
  let storage: StorageSuite;
  let maps: Record<string, Map<string, unknown>>;
  let vault: KeyVaultService;

  beforeEach(async () => {
    ({ suite: storage, maps } = memoryStorage());
    vault = svc(storage);
  });

  it("rejects a private key swapped between two records", async () => {
    await vault.generateKey(PASSWORD, "k1");
    await vault.importKey("11".repeat(32), PASSWORD, "k2");

    const records = maps.local.get("encryptedKeys") as KeyRecord[];
    // Swap record 2's sealed private key onto record 1. Both blobs are valid
    // AES-GCM ciphertexts; only the AAD makes this detectable.
    const tampered = [
      { ...records[0], ct: records[1].ct, iv: records[1].iv },
      records[1],
    ];
    maps.local.set("encryptedKeys", tampered);

    const result = await vault.unlock(PASSWORD);

    expect(
      result.damagedKeyIds,
      "a ciphertext moved to another record must not open"
    ).toContain(records[0].id);
    expect(result.unlockedKeyIds).toContain(records[1].id);
  });

  it("rejects a wrapped DEK swapped between two records", async () => {
    await vault.generateKey(PASSWORD, "k1");
    await vault.importKey("33".repeat(32), PASSWORD, "k2");

    const records = maps.local.get("encryptedKeys") as KeyRecord[];
    maps.local.set("encryptedKeys", [
      { ...records[0], wrappedDek: records[1].wrappedDek },
      records[1],
    ]);

    const result = await vault.unlock(PASSWORD);
    expect(result.damagedKeyIds).toContain(records[0].id);
  });

  it("rejects a record whose stored pubkey has been rewritten", async () => {
    await vault.generateKey(PASSWORD, "k1");
    const records = maps.local.get("encryptedKeys") as KeyRecord[];
    maps.local.set("encryptedKeys", [
      { ...records[0], pubkey: "cd".repeat(32) },
    ]);

    await expect(vault.unlock(PASSWORD)).rejects.toThrow("vault_keys_unreadable");
    expect((await vault.getLockState()).isLocked).toBe(true);
  });
});

describe("vault envelope: failure isolation and honest errors", () => {
  let storage: StorageSuite;
  let maps: Record<string, Map<string, unknown>>;
  let vault: KeyVaultService;

  beforeEach(() => {
    ({ suite: storage, maps } = memoryStorage());
    vault = svc(storage);
  });

  it("one damaged record does not prevent the others unlocking", async () => {
    await vault.generateKey(PASSWORD, "good1");
    await vault.importKey("44".repeat(32), PASSWORD, "bad");
    await vault.importKey("55".repeat(32), PASSWORD, "good2");

    const records = maps.local.get("encryptedKeys") as KeyRecord[];
    const corrupted = [...records];
    corrupted[1] = { ...records[1], ct: records[1].ct.map(() => 0) };
    maps.local.set("encryptedKeys", corrupted);

    const result = await vault.unlock(PASSWORD);

    // Before this change, Promise.all rejected wholesale and the user was told
    // their password was wrong.
    expect(result.unlockedKeyIds).toHaveLength(2);
    expect(result.damagedKeyIds).toEqual([records[1].id]);
  });

  it("reports a wrong password as a wrong password, not a damaged vault", async () => {
    await vault.generateKey(PASSWORD, "k1");
    await expect(vault.unlock("not-the-password")).rejects.toThrow(
      "incorrect_password"
    );
  });

  it("refuses to unlock a vault that does not exist yet", async () => {
    // Previously this resolved and marked the session unlocked, because
    // Promise.all over zero records resolves immediately.
    await expect(vault.unlock("anything at all")).rejects.toThrow(
      "vault_not_created"
    );
  });

  it("does not mark the session unlocked when the password is wrong", async () => {
    await vault.generateKey(PASSWORD, "k1");
    maps.session.delete("lockState");

    await expect(vault.unlock("wrong")).rejects.toThrow();

    expect(maps.session.get("lockState")).toBeUndefined();
  });
});

describe("vault envelope: legacy records and lazy migration", () => {
  let storage: StorageSuite;
  let maps: Record<string, Map<string, unknown>>;

  /** Builds a record in the pre-change on-disk format. */
  async function writeLegacyRecord(id: string, skHex: string) {
    const sk = Uint8Array.from(
      skHex.match(/../g)!.map((h) => parseInt(h, 16))
    ) as Uint8Array<ArrayBuffer>;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const raw = await deriveLegacyKeyReadOnly(PASSWORD, salt);
    const key = await WebCryptoAesGcm.importKey(raw, ["encrypt"]);
    const ct = await WebCryptoAesGcm.encrypt(
      key,
      iv,
      sk,
      new Uint8Array(0) as Uint8Array<ArrayBuffer>
    );
    const pub = NobleSchnorr.getPublicKey(sk) as Uint8Array;
    return {
      id,
      label: id,
      pubkey: Array.from(pub)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      ct: Array.from(ct),
      iv: Array.from(iv),
      salt: Array.from(salt),
      createdAt: 0,
      isSelected: true,
    } as KeyRecord;
  }

  beforeEach(() => {
    ({ suite: storage, maps } = memoryStorage());
  });

  it("opens a single legacy record and migrates it in place", async () => {
    const legacy = await writeLegacyRecord("L1", "66".repeat(32));
    maps.local.set("encryptedKeys", [legacy]);
    const vault = svc(storage);

    const result = await vault.unlock(PASSWORD);
    expect(result.unlockedKeyIds).toEqual(["L1"]);
    expect(result.damagedKeyIds).toHaveLength(0);

    const after = (maps.local.get("encryptedKeys") as KeyRecord[])[0];
    expect(after.v).toBe(VAULT_VERSION);
    expect(after.wrappedDek).toBeDefined();
    expect(after.salt, "legacy salt is dropped only after verification").toBeUndefined();
    expect(after.pubkey).toBe(legacy.pubkey);

    // And it opens again on the migrated path.
    const vault2 = svc(storage);
    const again = await vault2.unlock(PASSWORD);
    expect(again.unlockedKeyIds).toEqual(["L1"]);
  });

  it("migrates a vault holding two legacy records", async () => {
    maps.local.set("encryptedKeys", [
      await writeLegacyRecord("L1", "66".repeat(32)),
      await writeLegacyRecord("L2", "77".repeat(32)),
    ]);
    const result = await svc(storage).unlock(PASSWORD);
    expect(result.unlockedKeyIds.sort()).toEqual(["L1", "L2"]);
    const after = maps.local.get("encryptedKeys") as KeyRecord[];
    expect(after.every((r) => r.v === VAULT_VERSION)).toBe(true);
  });

  it("handles a mixed vault of legacy and versioned records", async () => {
    maps.local.set("encryptedKeys", [await writeLegacyRecord("L1", "66".repeat(32))]);
    const vault = svc(storage);
    // Adding a key creates the envelope and writes a v:1 record alongside.
    await vault.importKey("88".repeat(32), PASSWORD, "new");

    const result = await svc(storage).unlock(PASSWORD);
    expect(result.unlockedKeyIds).toHaveLength(2);
    expect(result.damagedKeyIds).toHaveLength(0);
  });

  it("rejects a wrong password against a legacy-only vault", async () => {
    maps.local.set("encryptedKeys", [await writeLegacyRecord("L1", "66".repeat(32))]);
    await expect(svc(storage).unlock("wrong")).rejects.toThrow(
      "incorrect_password"
    );
    // And must not have created an envelope for the wrong password.
    expect(maps.local.get("vaultEnvelope")).toBeUndefined();
  });

  it("keeps the key usable when migration cannot complete", async () => {
    // Simulates the write-verify step failing: the legacy record must be left
    // exactly as it was, and the key must still unlock.
    const legacy = await writeLegacyRecord("L1", "66".repeat(32));
    maps.local.set("encryptedKeys", [legacy]);

    let calls = 0;
    const flakyAead = {
      ...WebCryptoAesGcm,
      async encrypt(...args: Parameters<typeof WebCryptoAesGcm.encrypt>) {
        calls++;
        // Let the envelope verifier through, then fail the migration seal.
        if (calls > 1) throw new Error("simulated storage failure");
        return WebCryptoAesGcm.encrypt(...args);
      },
    };
    const vault = new KeyVaultService(
      storage,
      flakyAead as never,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );

    const result = await vault.unlock(PASSWORD);

    expect(result.unlockedKeyIds).toEqual(["L1"]);
    const after = (maps.local.get("encryptedKeys") as KeyRecord[])[0];
    expect(after.salt, "a failed migration must not drop the legacy salt").toBeDefined();
    expect(after.v).toBeUndefined();
  });
});

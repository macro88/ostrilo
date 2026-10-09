import { describe, it, expect, beforeEach, vi } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { SETTINGS_CHANGED_EVENT, defaultSettings } from "@/application/services/settings.service";
import type { CryptoAead, CryptoKdf, SecretBytes } from "@/application/ports/crypto";
import type { StorageSuite } from "@/application/ports/storage";
import {
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
  WebCryptoAesGcm,
  deriveLegacyKeyReadOnly,
} from "@/infrastructure/crypto/adapters";
import { verifierAad } from "@/domain/crypto/aad";
import {
  KDF_FLOORS,
  VAULT_VERSION,
  type AppSettingsV1,
  type KdfParams,
  type KeyRecord,
  type VaultEnvelope,
} from "@/domain/types";
import { bytesToHex, hexToBytes } from "@/domain/utils/hex";
import { fastKdf, memoryStorage } from "../../helpers/vault";

// Some of these run a real KDF at production cost, legacy PBKDF2 at 100,000
// iterations among them. Under V8 coverage on a CI runner one such unlock
// takes 15-25s, past the 10s default, so the timeout is raised here rather
// than the cost lowered.
vi.setConfig({ testTimeout: 60_000 });

const broadcasts = vi.hoisted(() => [] as unknown[]);

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: async (message: unknown) => {
        broadcasts.push(message);
      },
    },
  },
}));

const PASSWORD = "paths-test-password";
const SK_A = "11".repeat(32);
const SK_B = "22".repeat(32);
const VERIFIER_PLAINTEXT = "ostrilo/vault-verifier/v1";

interface Retained {
  buf: Uint8Array;
  hexAtReturn: string;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

function pubkeyOf(skHex: string): string {
  return bytesToHex(NobleSchnorr.getPublicKey(hexToBytes(skHex)));
}

function recordingAead(
  retained: Retained[],
  transform?: (out: SecretBytes, call: number) => SecretBytes
): CryptoAead {
  let calls = 0;
  return {
    importKey: (raw, usages) => WebCryptoAesGcm.importKey(raw, usages),
    encrypt: (key, iv, data, aad) => WebCryptoAesGcm.encrypt(key, iv, data, aad),
    async decrypt(key, iv, data, aad) {
      calls += 1;
      const plain = await WebCryptoAesGcm.decrypt(key, iv, data, aad);
      const out = transform ? transform(plain, calls) : plain;
      retained.push({ buf: out, hexAtReturn: bytesToHex(out) });
      return out;
    },
  };
}

function build(
  storage: StorageSuite,
  aead: CryptoAead = WebCryptoAesGcm,
  kdf: CryptoKdf = fastKdf
): KeyVaultService {
  return new KeyVaultService(storage, aead, kdf, NobleSchnorr, NobleSha256, ScureBech32);
}

async function legacyRecord(
  id: string,
  skBytes: Uint8Array,
  pubkey: string,
  password = PASSWORD
): Promise<KeyRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await deriveLegacyKeyReadOnly(password, salt);
  const key = await WebCryptoAesGcm.importKey(raw, ["encrypt"]);
  const ct = await WebCryptoAesGcm.encrypt(
    key,
    iv,
    Uint8Array.from(skBytes),
    new Uint8Array(0)
  );
  return {
    id,
    label: id,
    pubkey,
    ct: Array.from(ct),
    iv: Array.from(iv),
    salt: Array.from(salt),
    createdAt: 0,
    isSelected: true,
  };
}

async function envelopeFor(
  password: string,
  kdf: KdfParams,
  plaintext = VERIFIER_PLAINTEXT
): Promise<VaultEnvelope> {
  const kek = await fastKdf.deriveKey(password, kdf);
  const key = await WebCryptoAesGcm.importKey(kek, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await WebCryptoAesGcm.encrypt(
    key,
    iv,
    new TextEncoder().encode(plaintext),
    verifierAad(VAULT_VERSION, kdf)
  );
  return {
    v: VAULT_VERSION,
    kdf,
    verifier: { ct: Array.from(ct), iv: Array.from(iv) },
    createdAt: 0,
    updatedAt: 0,
  };
}

function pbkdf2Params(): KdfParams {
  return {
    alg: "pbkdf2-sha256",
    c: KDF_FLOORS["pbkdf2-sha256"].c,
    salt: Array.from(crypto.getRandomValues(new Uint8Array(16))),
  };
}

describe("KeyVaultService failure and edge paths", () => {
  let storage: StorageSuite;
  let vault: KeyVaultService;

  const keys = async () =>
    (await storage.local.get<KeyRecord[]>("encryptedKeys")) ?? [];
  const envelope = async () =>
    (await storage.local.get<VaultEnvelope>("vaultEnvelope")) as VaultEnvelope;
  const settings = async () => storage.local.get<AppSettingsV1>("appSettings");
  const lockState = async () =>
    storage.session.get<{ isLocked: boolean; selectedKeyId?: string; lastActivity: number }>(
      "lockState"
    );

  beforeEach(() => {
    storage = memoryStorage();
    vault = build(storage);
    broadcasts.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("recorded KDF parameters", () => {
    it.each(["m", "t", "p"] as const)(
      "refuses an Argon2id envelope whose %s is below the floor",
      async (field) => {
        await vault.importKey(SK_A, PASSWORD);
        const env = await envelope();
        const floors = KDF_FLOORS.argon2id;
        await storage.local.set("vaultEnvelope", {
          ...env,
          kdf: { ...env.kdf, [field]: floors[field] - 1 },
        });

        await expect(build(storage).unlock(PASSWORD)).rejects.toThrow(
          "kdf_below_floor"
        );
        expect((await lockState())?.isLocked).not.toBe(false);
      }
    );

    it("refuses an envelope recorded with an unknown KDF algorithm", async () => {
      await vault.importKey(SK_A, PASSWORD);
      const env = await envelope();
      await storage.local.set("vaultEnvelope", {
        ...env,
        kdf: { alg: "scrypt", salt: env.kdf.salt },
      });

      await expect(build(storage).unlock(PASSWORD)).rejects.toThrow(
        "kdf_unknown_algorithm"
      );
    });

    it("accepts an envelope recorded with PBKDF2 at its floor", async () => {
      const kdf = pbkdf2Params();
      await storage.local.set("vaultEnvelope", await envelopeFor(PASSWORD, kdf));

      const record = await vault.importKey(SK_A, PASSWORD);
      const result = await build(storage).unlock(PASSWORD);

      expect(result.unlockedKeyIds).toEqual([record.id]);
      expect((await envelope()).kdf).toEqual(kdf);
    });

    it("treats a verifier that decrypts to the wrong plaintext as a wrong password", async () => {
      const kdf = pbkdf2Params();
      await storage.local.set(
        "vaultEnvelope",
        await envelopeFor(PASSWORD, kdf, "not the verifier")
      );

      await expect(vault.importKey(SK_A, PASSWORD)).rejects.toThrow(
        "incorrect_password"
      );
      expect(await keys()).toEqual([]);
    });
  });

  it("zeroizes the fresh KEK and stores nothing when sealing the verifier fails", async () => {
    const derived: Uint8Array[] = [];
    const retainingKdf: CryptoKdf = {
      async deriveKey(password, params) {
        const kek = await fastKdf.deriveKey(password, params);
        derived.push(kek);
        return kek;
      },
    };
    const failingAead: CryptoAead = {
      ...WebCryptoAesGcm,
      async importKey() {
        throw new Error("import failed");
      },
    };

    await expect(
      build(storage, failingAead, retainingKdf).generateKey(PASSWORD)
    ).rejects.toThrow("import failed");

    expect(derived).toHaveLength(1);
    expect(isZero(derived[0])).toBe(true);
    expect(await storage.local.get("vaultEnvelope")).toBeUndefined();
    expect(await keys()).toEqual([]);
  });

  describe("unlock", () => {
    it("tells open surfaces to read the settings again, because they were redacted while locked", async () => {
      await vault.importKey(SK_A, PASSWORD);
      broadcasts.length = 0;

      await build(storage).unlock(PASSWORD);

      expect(broadcasts).toEqual([{ __event: SETTINGS_CHANGED_EVENT }]);
    });

    it("broadcasts nothing when the password is wrong", async () => {
      await vault.importKey(SK_A, PASSWORD);
      broadcasts.length = 0;

      await expect(build(storage).unlock("not the password")).rejects.toThrow();

      expect(broadcasts).toEqual([]);
    });
  });

  describe("unlock with damaged records", () => {
    it("reports a versioned record without a wrapped DEK as damaged and unlocks the rest", async () => {
      const a = await vault.importKey(SK_A, PASSWORD);
      const b = await vault.importKey(SK_B, PASSWORD);
      const stored = await keys();
      const { wrappedDek: _dropped, ...withoutDek } = stored[1];
      await storage.local.set("encryptedKeys", [stored[0], withoutDek]);

      const result = await build(storage).unlock(PASSWORD);

      expect(result.unlockedKeyIds).toEqual([a.id]);
      expect(result.damagedKeyIds).toEqual([b.id]);
    });

    it("reports an unversioned record with no salt as damaged", async () => {
      const a = await vault.importKey(SK_A, PASSWORD);
      const stored = await keys();
      const saltless: KeyRecord = {
        id: "saltless",
        pubkey: pubkeyOf(SK_B),
        ct: stored[0].ct,
        iv: stored[0].iv,
        createdAt: 0,
      };
      await storage.local.set("encryptedKeys", [...stored, saltless]);

      const result = await build(storage).unlock(PASSWORD);

      expect(result.unlockedKeyIds).toEqual([a.id]);
      expect(result.damagedKeyIds).toEqual(["saltless"]);
    });

    it("rejects a legacy record whose stored pubkey was rewritten and zeroizes the decrypted key", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_B)),
      ]);
      const retained: Retained[] = [];

      await expect(
        build(storage, recordingAead(retained)).unlock(PASSWORD)
      ).rejects.toThrow("vault_keys_unreadable");

      const recovered = retained.filter((r) => r.hexAtReturn === SK_A);
      expect(recovered.length).toBeGreaterThan(0);
      expect(recovered.every((r) => isZero(r.buf))).toBe(true);
      expect((await keys())[0].salt).toBeDefined();
    });

    it("refuses to unlock when a legacy record decrypts to an invalid scalar", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("zero", new Uint8Array(32), pubkeyOf(SK_A)),
      ]);

      await expect(vault.unlock(PASSWORD)).rejects.toThrow("vault_keys_unreadable");
      await expect(vault.sign("ab".repeat(32))).rejects.toThrow("no_unlocked_key");
      expect((await vault.getLockState()).isLocked).toBe(true);
    });

    it("keeps the legacy record when the migrated copy does not read back to the same key", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_A)),
      ]);
      const retained: Retained[] = [];
      const corruptRoundTrip = (out: SecretBytes, call: number): SecretBytes => {
        if (call === 4) out[0] ^= 0xff;
        return out;
      };
      const service = build(storage, recordingAead(retained, corruptRoundTrip));

      const result = await service.unlock(PASSWORD);

      expect(result.unlockedKeyIds).toEqual(["L1"]);
      const after = (await keys())[0];
      expect(after.v).toBeUndefined();
      expect(after.salt).toBeDefined();
      expect(isZero(retained[3].buf)).toBe(true);
      const hash = "cd".repeat(32);
      const { sigHex } = await service.sign(hash, "L1");
      expect(
        NobleSchnorr.verify(hexToBytes(sigHex), hexToBytes(hash), hexToBytes(pubkeyOf(SK_A)))
      ).toBe(true);
    });
  });

  describe("key selection and management", () => {
    it("selects the first imported key and records it in settings", async () => {
      const record = await vault.importKey(SK_A, PASSWORD, "first");

      expect(record.isSelected).toBe(true);
      expect((await settings())?.selectedKeyId).toBe(record.id);
      expect((await settings())?.__version).toBe("settings.v1");
    });

    it("does not select a new key when a stored record is already marked selected", async () => {
      const first = await vault.generateKey(PASSWORD, "first");
      await storage.local.remove("appSettings");

      const second = await vault.generateKey(PASSWORD, "second");

      expect(second.isSelected).toBe(false);
      const stored = await keys();
      expect(stored.map((r) => [r.id, r.isSelected])).toEqual([
        [first.id, true],
        [second.id, false],
      ]);
      expect(await settings()).toBeUndefined();
    });

    it("moves the session's selected key when switching while unlocked", async () => {
      await vault.importKey(SK_A, PASSWORD);
      const b = await vault.importKey(SK_B, PASSWORD);
      await vault.unlock(PASSWORD);

      await vault.selectKey(b.id);

      expect((await lockState())?.selectedKeyId).toBe(b.id);
      expect((await settings())?.selectedKeyId).toBe(b.id);
      expect((await keys()).map((r) => r.isSelected)).toEqual([false, true]);
    });

    it("writes complete default settings when selecting a key with none stored", async () => {
      const record = await vault.importKey(SK_A, PASSWORD);
      await storage.local.remove("appSettings");

      await vault.selectKey(record.id);

      expect(await settings()).toEqual({
        ...defaultSettings(),
        selectedKeyId: record.id,
      });
    });

    it("requires a password to import a key", async () => {
      await expect(vault.importKey(SK_A, "")).rejects.toThrow("password_required");
      expect(await keys()).toEqual([]);
    });

    it("leaves a locked session locked when switching keys", async () => {
      await vault.importKey(SK_A, PASSWORD);
      const b = await vault.importKey(SK_B, PASSWORD);
      await vault.lock();

      await vault.selectKey(b.id);

      expect(await lockState()).toMatchObject({ isLocked: true, selectedKeyId: undefined });
      expect((await settings())?.selectedKeyId).toBe(b.id);
    });

    it("renames a key without touching its sealed material", async () => {
      const record = await vault.importKey(SK_A, PASSWORD, "old");
      const before = (await keys())[0];

      await vault.renameKey(record.id, "new name");

      const after = (await keys())[0];
      expect(after.label).toBe("new name");
      expect(after.ct).toEqual(before.ct);
      expect(after.wrappedDek).toEqual(before.wrappedDek);
    });

    it("refuses to rename a key that does not exist", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await expect(vault.renameKey("missing", "x")).rejects.toThrow("key_not_found");
    });

    it("refuses to delete the last key", async () => {
      const record = await vault.importKey(SK_A, PASSWORD);

      await expect(vault.deleteKey(record.id)).rejects.toThrow("cannot_delete_last_key");
      expect(await keys()).toHaveLength(1);
    });

    it("refuses to delete a key that does not exist", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await vault.importKey(SK_B, PASSWORD);

      await expect(vault.deleteKey("missing")).rejects.toThrow("key_not_found");
      expect(await keys()).toHaveLength(2);
    });

    it("zeroizes a deleted unlocked key and selects the remaining one", async () => {
      const retained: Retained[] = [];
      const service = build(storage, recordingAead(retained));
      const a = await service.importKey(SK_A, PASSWORD);
      const b = await service.importKey(SK_B, PASSWORD);
      await service.unlock(PASSWORD);
      const liveA = retained.filter((r) => r.hexAtReturn === SK_A);
      expect(liveA.some((r) => !isZero(r.buf))).toBe(true);

      const result = await service.deleteKey(a.id);

      expect(result.newSelectedKeyId).toBe(b.id);
      expect(liveA.every((r) => isZero(r.buf))).toBe(true);
      expect((await settings())?.selectedKeyId).toBe(b.id);
      expect((await keys()).map((r) => r.id)).toEqual([b.id]);
      await expect(service.sign("ab".repeat(32), a.id)).rejects.toThrow(
        "key_locked_or_missing"
      );
      await expect(service.sign("ab".repeat(32), b.id)).resolves.toMatchObject({
        keyId: b.id,
      });
    });

    it("falls back to the first readable key, not an unreadable one, when the selected key is deleted", async () => {
      const a = await vault.importKey(SK_A, PASSWORD);
      const damaged = await vault.importKey(SK_B, PASSWORD);
      const c = await vault.importKey("33".repeat(32), PASSWORD);
      await storage.local.set(
        "encryptedKeys",
        (await keys()).map((r) =>
          r.id === damaged.id ? { ...r, pubkey: pubkeyOf(SK_A) } : r
        )
      );
      await vault.unlock(PASSWORD);
      expect(vault.isKeyUnreadable(damaged.id)).toBe(true);

      const result = await vault.deleteKey(a.id);

      expect(result.newSelectedKeyId).toBe(c.id);
      expect((await settings())?.selectedKeyId).toBe(c.id);
    });

    it("keeps the selection when deleting a key that is not selected", async () => {
      const a = await vault.importKey(SK_A, PASSWORD);
      const b = await vault.importKey(SK_B, PASSWORD);

      const result = await vault.deleteKey(b.id);

      expect(result.newSelectedKeyId).toBeUndefined();
      expect((await settings())?.selectedKeyId).toBe(a.id);
    });
  });

  describe("lock and unlock listeners", () => {
    it("runs every unlock listener and still unlocks when one rejects", async () => {
      await vault.importKey(SK_A, PASSWORD);
      const ran: string[] = [];
      vault.onUnlock(async () => {
        ran.push("first");
        throw new Error("listener broke");
      });
      vault.onUnlock(() => {
        ran.push("second");
      });

      const result = await vault.unlock(PASSWORD);

      expect(ran).toEqual(["first", "second"]);
      expect(result.unlockedKeyIds).toHaveLength(1);
      expect((await lockState())?.isLocked).toBe(false);
    });

    it("runs every lock listener after the vault is locked, even when one rejects", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await vault.unlock(PASSWORD);
      const observed: boolean[] = [];
      vault.onLock(async () => {
        throw new Error("listener broke");
      });
      vault.onLock(async () => {
        observed.push((await vault.getLockState()).isLocked);
      });

      await vault.lock();

      expect(observed).toEqual([true]);
      await expect(vault.sign("ab".repeat(32))).rejects.toThrow("no_unlocked_key");
    });
  });

  describe("lock", () => {
    it("clears every origin's session grant and broadcasts the settings change", async () => {
      await vault.importKey(SK_A, PASSWORD);
      const current = (await settings()) ?? defaultSettings();
      await storage.local.set("appSettings", {
        ...current,
        origins: [
          { origin: "https://a.example", trustLevel: "medium", rules: {}, sessionGrantAll: true, updatedAt: 1 },
          { origin: "https://b.example", trustLevel: "low", rules: {}, updatedAt: 2 },
        ],
      });
      await storage.session.set("sessionGrants", { "https://a.example": true });

      await vault.lock();

      const origins = (await settings())?.origins ?? [];
      expect(origins.map((o) => [o.origin, o.sessionGrantAll])).toEqual([
        ["https://a.example", false],
        ["https://b.example", false],
      ]);
      expect(await storage.session.get("sessionGrants")).toBeUndefined();
      expect(broadcasts).toEqual([{ __event: SETTINGS_CHANGED_EVENT }]);
    });

    it("writes no settings and broadcasts nothing when none are stored", async () => {
      await vault.lock();

      expect(await settings()).toBeUndefined();
      expect(broadcasts).toEqual([]);
      expect((await lockState())?.isLocked).toBe(true);
    });
  });

  describe("getLockState deadline handling", () => {
    it.each([
      ["a non-numeric", "yesterday"],
      ["a zero", 0],
      ["a future", Date.now() + 3_600_000],
    ])("locks and wipes keys when the stored activity time is %s value", async (_label, lastActivity) => {
      await vault.importKey(SK_A, PASSWORD);
      await vault.unlock(PASSWORD);
      const state = await lockState();
      await storage.session.set("lockState", { ...state, lastActivity });

      expect((await vault.getLockState()).isLocked).toBe(true);
      await expect(vault.sign("ab".repeat(32))).rejects.toThrow("no_unlocked_key");
    });
  });

  describe("sign", () => {
    it("refuses to sign with a key ID that is not unlocked", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await vault.unlock(PASSWORD);

      await expect(vault.sign("ab".repeat(32), "not-a-key")).rejects.toThrow(
        "key_locked_or_missing"
      );
    });
  });

  describe("verifyPassword", () => {
    it("requires a password", async () => {
      await expect(vault.verifyPassword("")).rejects.toThrow("password_required");
    });

    it("reports a vault with no keys as not created", async () => {
      await expect(vault.verifyPassword(PASSWORD)).rejects.toThrow("vault_not_created");
    });

    it("verifies against a legacy record when the vault has not migrated", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_A)),
      ]);

      await expect(vault.verifyPassword(PASSWORD)).resolves.toBeUndefined();
      await expect(vault.verifyPassword("wrong password")).rejects.toThrow(
        "incorrect_password"
      );
    });

    it("rejects a legacy record whose pubkey does not match as a wrong password", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_B)),
      ]);

      await expect(vault.verifyPassword(PASSWORD)).rejects.toThrow("incorrect_password");
    });

    it("reports a versioned vault whose envelope is missing as not created", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await storage.local.remove("vaultEnvelope");

      await expect(vault.verifyPassword(PASSWORD)).rejects.toThrow("vault_not_created");
    });
  });

  describe("revealKey", () => {
    it("refuses when no key is named and none is selected", async () => {
      await vault.importKey(SK_A, PASSWORD);
      await storage.local.remove("appSettings");

      await expect(vault.revealKey(PASSWORD)).rejects.toThrow("vault_locked");
    });

    it("refuses a key ID that does not exist", async () => {
      await vault.importKey(SK_A, PASSWORD);

      await expect(vault.revealKey(PASSWORD, "missing")).rejects.toThrow("key_not_found");
    });

    it("reveals a legacy record's key", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_A)),
      ]);

      const revealed = await vault.revealKey(PASSWORD, "L1");

      expect(revealed.hex).toBe(SK_A);
      expect(revealed.nsec).toBe(ScureBech32.encode("nsec", hexToBytes(SK_A)));
    });

    it("refuses to reveal a legacy key that does not match its stored pubkey", async () => {
      await storage.local.set("encryptedKeys", [
        await legacyRecord("L1", hexToBytes(SK_A), pubkeyOf(SK_B)),
      ]);

      await expect(vault.revealKey(PASSWORD, "L1")).rejects.toThrow("pubkey_mismatch");
    });

    it("reports a versioned record whose envelope is missing as not created", async () => {
      const record = await vault.importKey(SK_A, PASSWORD);
      await storage.local.remove("vaultEnvelope");

      await expect(vault.revealKey(PASSWORD, record.id)).rejects.toThrow(
        "vault_not_created"
      );
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KeyVaultService,
  VaultDamagedRecordsError,
} from "@/application/services/key-vault.service";
import { KDF_DEFAULTS, type KeyRecord, type VaultEnvelope } from "@/domain/types";
import type { StorageSuite } from "@/application/ports/storage";
import { memoryStorage, testVault } from "../../helpers/vault";

const OLD = "Old-Harbour-Lantern-58";
const NEW = "New-Quartz-Meadow-2026";
const SECRETS = [
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000002",
  "0000000000000000000000000000000000000000000000000000000000000003",
];

let storage: StorageSuite;
let vault: KeyVaultService;

async function stored() {
  return {
    envelope: (await storage.local.get<VaultEnvelope>("vaultEnvelope"))!,
    records: (await storage.local.get<KeyRecord[]>("encryptedKeys"))!,
  };
}

/** A fresh service over the same storage: what a restarted worker sees. */
function restarted(): KeyVaultService {
  return testVault(storage).vault;
}

beforeEach(async () => {
  storage = memoryStorage();
  vault = testVault(storage).vault;
  for (const secret of SECRETS) await vault.importKey(secret, OLD);
  await vault.unlock(OLD);
});

describe("changePassword", () => {
  it("re-wraps every DEK and leaves every private-key ciphertext byte-identical", async () => {
    const before = await stored();

    await vault.changePassword(OLD, NEW);

    const after = await stored();
    expect(after.records.map((r) => [r.id, r.ct, r.iv])).toEqual(
      before.records.map((r) => [r.id, r.ct, r.iv])
    );
    for (let i = 0; i < before.records.length; i++) {
      expect(after.records[i].wrappedDek).not.toEqual(before.records[i].wrappedDek);
    }
    expect(after.envelope.kdf.salt).not.toEqual(before.envelope.kdf.salt);
    expect(after.envelope.verifier).not.toEqual(before.envelope.verifier);
    expect(after.envelope.createdAt).toBe(before.envelope.createdAt);
    expect(await storage.local.get("vaultRotation")).toBeUndefined();
  });

  it("opens every key under the new password and refuses the old one", async () => {
    await vault.changePassword(OLD, NEW);

    await expect(restarted().unlock(OLD)).rejects.toThrow("incorrect_password");
    const result = await restarted().unlock(NEW);
    expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
    expect(result.damagedKeyIds).toEqual([]);
  });

  it("writes the current default KDF parameters, upgrading an older work factor", async () => {
    // Recreate the vault with a non-default (but acceptable) memory cost.
    storage = memoryStorage();
    vault = testVault(storage).vault;
    const salt = Array.from({ length: 16 }, (_, i) => i);
    vi.spyOn(vault as unknown as { freshKdfParams: () => unknown }, "freshKdfParams")
      .mockReturnValueOnce({ ...KDF_DEFAULTS, m: KDF_DEFAULTS.alg === "argon2id" ? 38912 : 0, salt });
    await vault.importKey(SECRETS[0], OLD);
    expect((await stored()).envelope.kdf).toMatchObject({ m: 38912 });

    await vault.changePassword(OLD, NEW);

    const { kdf } = (await stored()).envelope;
    const { salt: newSalt, ...params } = kdf as typeof kdf & { salt: number[] };
    const { salt: _unused, ...defaults } = KDF_DEFAULTS as typeof KDF_DEFAULTS & { salt: number[] };
    expect(params).toEqual(defaults);
    expect(newSalt).toHaveLength(16);
    expect(newSalt).not.toEqual(salt);
  });

  it("keeps the session unlocked with its keys", async () => {
    await vault.changePassword(OLD, NEW);
    expect((await vault.getLockState()).isLocked).toBe(false);
    await expect(vault.sign("ab".repeat(32))).resolves.toBeDefined();
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const before = await stored();
    await expect(vault.changePassword("Wrong-Current-Password-1", NEW)).rejects.toThrow(
      "incorrect_password"
    );
    expect(await stored()).toEqual(before);
  });

  it("refuses while a legacy record remains, changing nothing", async () => {
    const before = await stored();
    const legacy = { ...before.records[0], id: "legacy-1", v: undefined, salt: [1, 2, 3] };
    await storage.local.set("encryptedKeys", [...before.records, legacy]);
    const withLegacy = await stored();

    await expect(vault.changePassword(OLD, NEW)).rejects.toThrow("vault_has_legacy_records");
    expect(await stored()).toEqual(withLegacy);
  });

  it("refuses when a record does not open, naming it, and changes nothing", async () => {
    const before = await stored();
    const broken = structuredClone(before.records);
    broken[1].wrappedDek!.ct[0] ^= 0xff;
    await storage.local.set("encryptedKeys", broken);

    const error = await vault.changePassword(OLD, NEW).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VaultDamagedRecordsError);
    expect((error as VaultDamagedRecordsError).keyIds).toEqual([broken[1].id]);
    expect((await stored()).records).toEqual(broken);
    expect((await stored()).envelope).toEqual(before.envelope);
  });

  it("refuses a missing password and an empty vault", async () => {
    await expect(vault.changePassword("", NEW)).rejects.toThrow("password_required");
    const empty = testVault(memoryStorage()).vault;
    await expect(empty.changePassword(OLD, NEW)).rejects.toThrow("vault_not_created");
  });

  it("serialises an import issued during the rotation behind it", async () => {
    const rotation = vault.changePassword(OLD, NEW);
    const imported = vault.importKey(
      "0000000000000000000000000000000000000000000000000000000000000004",
      NEW,
      "added mid-rotation"
    );

    await rotation;
    const record = await imported;

    const result = await restarted().unlock(NEW);
    expect(result.unlockedKeyIds).toContain(record.id);
    expect(result.unlockedKeyIds).toHaveLength(SECRETS.length + 1);
    expect(result.damagedKeyIds).toEqual([]);
  });
  it("refuses to commit a re-wrap that does not verify, and changes nothing", async () => {
    const before = await stored();
    const matches = vi.spyOn(
      vault as unknown as { matchesPubkey: () => Promise<boolean> },
      "matchesPubkey"
    );
    // The damage scan passes every record; the round trip after re-wrap fails.
    for (let i = 0; i < SECRETS.length; i++) matches.mockResolvedValueOnce(true);
    matches.mockResolvedValue(false);

    await expect(vault.changePassword(OLD, NEW)).rejects.toThrow(
      "rotation_verification_failed"
    );
    expect(await stored()).toEqual(before);
    expect(await storage.local.get("vaultRotation")).toBeUndefined();
  });

  it("refuses a journal whose parameters are out of bounds rather than trusting it", async () => {
    const before = await stored();
    await storage.local.set("vaultRotation", {
      from: before,
      to: {
        envelope: { ...before.envelope, kdf: { ...before.envelope.kdf, m: 1 << 30 } },
        records: before.records,
      },
    });

    await expect(restarted().unlock(NEW)).rejects.toThrow("kdf_above_ceiling");
    expect(await stored()).toEqual(before);
  });
});

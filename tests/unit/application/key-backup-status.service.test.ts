import { describe, expect, it } from "vitest";
import {
  KEY_BACKUP_STORAGE,
  KeyBackupStatusService,
} from "@/application/services/key-backup-status.service";
import { memoryStorage, testVault } from "../../helpers/vault";
import { SECRET_ONE, STRONG_PASSWORD } from "../infrastructure/messaging-fixture";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function service(start = 1_000) {
  const storage = memoryStorage();
  let clock = start;
  const svc = new KeyBackupStatusService(storage.local, () => clock);
  return { svc, storage, tick: (ms: number) => (clock += ms) };
}

describe("KeyBackupStatusService", () => {
  it("reports no record for a key it has never heard of", async () => {
    const { svc } = service();
    expect(await svc.list()).toEqual([]);
  });

  it("stamps pending, then verified, with the time of each change", async () => {
    const { svc, tick } = service(1_000);
    await svc.markPending(A);
    expect(await svc.list()).toEqual([{ keyId: A, state: "pending", at: 1_000 }]);

    tick(500);
    await svc.markVerified(A);
    expect(await svc.list()).toEqual([{ keyId: A, state: "verified", at: 1_500 }]);
  });

  it("verifies a key that had no record, as a backup from Settings does for a legacy key", async () => {
    const { svc } = service();
    await svc.markVerified(A);
    expect((await svc.list())[0]).toMatchObject({ keyId: A, state: "verified" });
  });

  it("keeps keys independent and removes only the one asked for", async () => {
    const { svc } = service();
    await svc.markPending(A);
    await svc.markPending(B);
    await svc.remove(A);
    expect((await svc.list()).map((r) => r.keyId)).toEqual([B]);
  });

  it("does not lose a write when two arrive together", async () => {
    const { svc } = service();
    await Promise.all([svc.markPending(A), svc.markPending(B)]);
    expect((await svc.list()).map((r) => r.keyId).sort()).toEqual([A, B]);
  });

  it("treats a corrupt stored record as no record", async () => {
    const { svc, storage } = service();
    await storage.local.set(KEY_BACKUP_STORAGE, "garbage");
    expect(await svc.list()).toEqual([]);
    await svc.markPending(A);
    expect((await svc.list()).map((r) => r.keyId)).toEqual([A]);
  });

  it("stores nothing but ids, states and times", async () => {
    const { svc, storage } = service();
    await svc.markVerified(A);
    expect(await storage.local.get(KEY_BACKUP_STORAGE)).toEqual({
      __version: "keyBackup.v1",
      keys: { [A]: { state: "verified", at: 1_000 } },
    });
  });
});

describe("the vault and backup status", () => {
  it("sets a generated key pending", async () => {
    const { vault } = testVault();
    const key = await vault.generateKey(STRONG_PASSWORD, "made here");
    expect(await vault.backupStatus.list()).toEqual([
      expect.objectContaining({ keyId: key.id, state: "pending" }),
    ]);
  });

  it("gives an imported key no record, because the user already holds the secret", async () => {
    const { vault } = testVault();
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "imported");
    expect(await vault.backupStatus.list()).toEqual([]);
  });

  it("drops a deleted key's record", async () => {
    const { vault } = testVault();
    const keep = await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "keep");
    const gone = await vault.generateKey(STRONG_PASSWORD, "gone");
    await vault.deleteKey(gone.id);
    expect(await vault.backupStatus.list()).toEqual([]);
    expect((await vault.listKeys()).map((k) => k.id)).toEqual([keep.id]);
  });

  it("creates no key when its status cannot be recorded", async () => {
    const storage = memoryStorage();
    const { vault } = testVault(storage);
    const realSet = storage.local.set.bind(storage.local);
    storage.local.set = async (key, value) => {
      if (key === KEY_BACKUP_STORAGE) throw new Error("quota");
      return realSet(key, value);
    };
    await expect(vault.generateKey(STRONG_PASSWORD, "x")).rejects.toThrow("quota");
    expect(await vault.listKeys()).toEqual([]);
  });
});

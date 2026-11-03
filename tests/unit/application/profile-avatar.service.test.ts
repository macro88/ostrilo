import { describe, expect, it, vi } from "vitest";
import {
  PROFILE_AVATAR_STORAGE,
  ProfileAvatarService,
} from "@/application/services/profile-avatar.service";
import { memoryStorage, testVault } from "../../helpers/vault";
import { PNG_DATA_URL, SOURCE_URL, WEBP_DATA_URL } from "../../helpers/avatar-fixtures";
import { SECRET_ONE, SECRET_TWO, STRONG_PASSWORD } from "../infrastructure/messaging-fixture";

const A = "a".repeat(64);
const B = "b".repeat(64);
const copy = { dataUrl: PNG_DATA_URL, sourceUrl: SOURCE_URL };

function service(start = 1_000) {
  const storage = memoryStorage();
  let clock = start;
  const svc = new ProfileAvatarService(storage.local, () => clock);
  return { svc, storage, tick: (ms: number) => (clock += ms) };
}

describe("ProfileAvatarService", () => {
  it("has no copy for a key it has never heard of", async () => {
    const { svc } = service();
    expect(await svc.get(A)).toBeNull();
  });

  it("stores a copy with its source URL and the time it was made", async () => {
    const { svc } = service(1_000);
    await svc.save(A, copy, [A]);
    expect(await svc.get(A)).toEqual({ pubkey: A, ...copy, at: 1_000 });
  });

  it("replaces the earlier copy, keeping one entry per key", async () => {
    const { svc, storage, tick } = service(1_000);
    await svc.save(A, copy, [A]);
    tick(500);
    await svc.save(A, { dataUrl: WEBP_DATA_URL, sourceUrl: "https://images.example/b.png" }, [A]);

    expect(await svc.get(A)).toMatchObject({ dataUrl: WEBP_DATA_URL, at: 1_500 });
    const record = (await storage.local.get(PROFILE_AVATAR_STORAGE)) as { avatars: object };
    expect(Object.keys(record.avatars)).toEqual([A]);
  });

  it("keeps keys independent", async () => {
    const { svc } = service();
    await svc.save(A, copy, [A, B]);
    await svc.save(B, { ...copy, dataUrl: WEBP_DATA_URL }, [A, B]);
    expect((await svc.get(A))?.dataUrl).toBe(PNG_DATA_URL);
    expect((await svc.get(B))?.dataUrl).toBe(WEBP_DATA_URL);
  });

  it("drops entries for keys the vault no longer holds when it saves", async () => {
    const { svc } = service();
    await svc.save(A, copy, [A, B]);
    await svc.save(B, copy, [B]);
    expect(await svc.get(A)).toBeNull();
    expect(await svc.get(B)).not.toBeNull();
  });

  it("removes one key's copy and leaves the other", async () => {
    const { svc } = service();
    await svc.save(A, copy, [A, B]);
    await svc.save(B, copy, [A, B]);
    await svc.remove(A);
    expect(await svc.get(A)).toBeNull();
    expect(await svc.get(B)).not.toBeNull();
  });

  it("removes the storage item once the last copy is gone", async () => {
    const { svc, storage } = service();
    await svc.save(A, copy, [A]);
    await svc.remove(A);
    expect(await storage.local.get(PROFILE_AVATAR_STORAGE)).toBeUndefined();
  });

  it("does not lose a write when two arrive together", async () => {
    const { svc } = service();
    await Promise.all([svc.save(A, copy, [A, B]), svc.save(B, copy, [A, B])]);
    expect(await svc.get(A)).not.toBeNull();
    expect(await svc.get(B)).not.toBeNull();
  });

  it("treats a corrupt stored record as no record, and writes over it", async () => {
    const { svc, storage } = service();
    await storage.local.set(PROFILE_AVATAR_STORAGE, "garbage");
    expect(await svc.get(A)).toBeNull();
    await svc.save(A, copy, [A]);
    expect(await svc.get(A)).not.toBeNull();
  });

  it("never returns a stored image that is not a png or webp data URL", async () => {
    const { svc, storage } = service();
    await storage.local.set(PROFILE_AVATAR_STORAGE, {
      __version: "profileAvatar.v1",
      avatars: { [A]: { ...copy, dataUrl: "https://relay.example/a.png", at: 1 } },
    });
    expect(await svc.get(A)).toBeNull();
  });

  it("stores nothing but the image, its source and a time", async () => {
    const { svc, storage } = service();
    await svc.save(A, copy, [A]);
    expect(await storage.local.get(PROFILE_AVATAR_STORAGE)).toEqual({
      __version: "profileAvatar.v1",
      avatars: { [A]: { ...copy, at: 1_000 } },
    });
  });
});

describe("the vault and the picture copy", () => {
  it("drops a deleted key's copy and keeps another key's", async () => {
    const { vault } = testVault();
    const keep = await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "keep");
    const gone = await vault.importKey(SECRET_TWO, STRONG_PASSWORD, "gone");
    const pubkeys = [keep.pubkey, gone.pubkey];
    await vault.profileAvatar.save(keep.pubkey, copy, pubkeys);
    await vault.profileAvatar.save(gone.pubkey, copy, pubkeys);

    await vault.deleteKey(gone.id);

    expect(await vault.profileAvatar.get(gone.pubkey)).toBeNull();
    expect(await vault.profileAvatar.get(keep.pubkey)).not.toBeNull();
  });

  it("still zeroizes, repairs the selection and drops the backup status when the copy cannot be removed", async () => {
    const storage = memoryStorage();
    const { vault } = testVault(storage);
    const first = await vault.generateKey(STRONG_PASSWORD, "first");
    const second = await vault.generateKey(STRONG_PASSWORD, "second");
    await vault.unlock(STRONG_PASSWORD);
    await vault.selectKey(second.id);
    await vault.profileAvatar.save(second.pubkey, copy, [first.pubkey, second.pubkey]);

    const unlocked = (vault as unknown as { unlocked: Map<string, Uint8Array> }).unlocked;
    const secret = unlocked.get(second.id)!;

    const realSet = storage.local.set.bind(storage.local);
    const realRemove = storage.local.remove.bind(storage.local);
    storage.local.set = async (key, value) => {
      if (key === PROFILE_AVATAR_STORAGE) throw new Error("quota");
      return realSet(key, value);
    };
    storage.local.remove = async (key) => {
      if (key === PROFILE_AVATAR_STORAGE) throw new Error("quota");
      return realRemove(key);
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await vault.deleteKey(second.id);

    expect(result.newSelectedKeyId).toBe(first.id);
    expect(unlocked.has(second.id)).toBe(false);
    expect(secret.every((byte) => byte === 0)).toBe(true);
    expect((await vault.listKeys()).map((k) => k.id)).toEqual([first.id]);
    expect(await vault.backupStatus.list()).toEqual([
      expect.objectContaining({ keyId: first.id }),
    ]);
  });
});

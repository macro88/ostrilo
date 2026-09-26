import { describe, expect, it } from "vitest";
import type { StoragePort, StorageSuite } from "@/application/ports/storage";
import { testVault } from "../helpers/vault";

/**
 * A password change rewrites two storage items - the vault envelope and the
 * key records - and neither browser documents a multi-key write as atomic. A
 * rotation interrupted between them must never leave a vault that neither
 * password opens. This suite is the change's acceptance gate: it makes storage
 * fail at every commit step and every recovery write, then restarts the
 * service the way a crashed worker would, and checks which password opens the
 * vault and that every key survives.
 */

const OLD = "Old-Harbour-Lantern-58";
const NEW = "New-Quartz-Meadow-2026";
const SECRETS = [
  "0000000000000000000000000000000000000000000000000000000000000001",
  "0000000000000000000000000000000000000000000000000000000000000002",
  "0000000000000000000000000000000000000000000000000000000000000003",
];

type Area = Map<string, unknown>;
type Snapshot = Record<"local" | "sync" | "session", Area>;

/** Storage over plain maps, with a fault hook and cheap deep copies. */
function faultyStorage(snapshot?: Snapshot) {
  const maps: Snapshot = snapshot
    ? {
        local: new Map(structuredClone([...snapshot.local])),
        sync: new Map(structuredClone([...snapshot.sync])),
        session: new Map(structuredClone([...snapshot.session])),
      }
    : { local: new Map(), sync: new Map(), session: new Map() };
  let fault: ((op: string) => boolean) | null = null;
  const area = (name: keyof Snapshot): StoragePort => ({
    async get<T>(key: string) {
      return structuredClone(maps[name].get(key)) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      if (fault?.(`${name}.set:${key}`)) throw new Error(`injected fault at set ${key}`);
      maps[name].set(key, structuredClone(value));
    },
    async remove(key: string) {
      if (fault?.(`${name}.remove:${key}`)) throw new Error(`injected fault at remove ${key}`);
      maps[name].delete(key);
    },
  });
  const storage: StorageSuite = {
    local: area("local"),
    sync: area("sync"),
    session: area("session"),
  };
  return {
    storage,
    maps,
    /** Fail the first operation that matches `op`, once. */
    failAt(op: string) {
      let fired = false;
      fault = (candidate) => {
        if (fired || candidate !== op) return false;
        fired = true;
        return true;
      };
    },
    clearFault() {
      fault = null;
    },
  };
}

async function seededVault() {
  const env = faultyStorage();
  const { vault } = testVault(env.storage);
  const pubkeys: string[] = [];
  for (const secret of SECRETS) pubkeys.push((await vault.importKey(secret, OLD)).pubkey);
  await vault.unlock(OLD);
  return { env, vault, pubkeys };
}

/** Unlocks a copy of `snapshot` with `password` in a freshly started service. */
async function unlockCopy(snapshot: Snapshot, password: string) {
  const copy = faultyStorage(snapshot);
  const { vault } = testVault(copy.storage);
  const result = await vault.unlock(password);
  return { copy, vault, result };
}

async function pubkeysOf(env: ReturnType<typeof faultyStorage>): Promise<string[]> {
  const records = (await env.storage.local.get<Array<{ pubkey: string }>>("encryptedKeys")) ?? [];
  return records.map((r) => r.pubkey).sort();
}

const COMMIT_STEPS = [
  { op: "local.set:vaultRotation", journalLeft: false },
  { op: "local.set:vaultEnvelope", journalLeft: true },
  { op: "local.set:encryptedKeys", journalLeft: true },
  { op: "local.remove:vaultRotation", journalLeft: true },
] as const;

describe("a password change interrupted at each commit step", () => {
  for (const step of COMMIT_STEPS) {
    describe(`fault at ${step.op}`, () => {
      async function interrupted() {
        const seeded = await seededVault();
        seeded.env.failAt(step.op);
        await expect(seeded.vault.changePassword(OLD, NEW)).rejects.toThrow("injected fault");
        seeded.env.clearFault();
        expect(seeded.env.maps.local.has("vaultRotation")).toBe(step.journalLeft);
        return seeded;
      }

      it("opens with the old password, every key intact, and the old password stays", async () => {
        const { env, pubkeys } = await interrupted();

        const { copy, result } = await unlockCopy(env.maps, OLD);

        expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
        expect(result.damagedKeyIds).toEqual([]);
        expect(await pubkeysOf(copy)).toEqual([...pubkeys].sort());
        expect(copy.maps.local.has("vaultRotation")).toBe(false);
        await expect(testVault(copy.storage).vault.unlock(NEW)).rejects.toThrow(
          "incorrect_password"
        );
        // Idempotent: a second unlock with the same password is unremarkable.
        const again = await testVault(copy.storage).vault.unlock(OLD);
        expect(again.unlockedKeyIds).toHaveLength(SECRETS.length);
      });

      if (step.journalLeft) {
        it("opens with the new password, every key intact, and the new password stays", async () => {
          const { env, pubkeys } = await interrupted();

          const { copy, result } = await unlockCopy(env.maps, NEW);

          expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
          expect(result.damagedKeyIds).toEqual([]);
          expect(await pubkeysOf(copy)).toEqual([...pubkeys].sort());
          expect(copy.maps.local.has("vaultRotation")).toBe(false);
          await expect(testVault(copy.storage).vault.unlock(OLD)).rejects.toThrow(
            "incorrect_password"
          );
        });
      } else {
        it("refuses the new password, which was never committed", async () => {
          const { env } = await interrupted();
          const copy = faultyStorage(env.maps);
          await expect(testVault(copy.storage).vault.unlock(NEW)).rejects.toThrow(
            "incorrect_password"
          );
        });
      }

      it("refuses a password that opens neither state, and keeps the journal", async () => {
        const { env } = await interrupted();
        const copy = faultyStorage(env.maps);
        await expect(
          testVault(copy.storage).vault.unlock("Neither-Password-At-All-9")
        ).rejects.toThrow("incorrect_password");
        expect(copy.maps.local.has("vaultRotation")).toBe(step.journalLeft);
      });
    });
  }
});

describe("an interrupted recovery", () => {
  const RECOVERY_WRITES = [
    "local.set:vaultEnvelope",
    "local.set:encryptedKeys",
    "local.remove:vaultRotation",
  ];

  for (const [password, label] of [
    [NEW, "rolling forward"],
    [OLD, "rolling back"],
  ] as const) {
    for (const op of RECOVERY_WRITES) {
      it(`completes on the next unlock when ${label} fails at ${op}`, async () => {
        const seeded = await seededVault();
        seeded.env.failAt("local.set:encryptedKeys");
        await expect(seeded.vault.changePassword(OLD, NEW)).rejects.toThrow();
        seeded.env.clearFault();

        const copy = faultyStorage(seeded.env.maps);
        copy.failAt(op);
        await expect(testVault(copy.storage).vault.unlock(password)).rejects.toThrow(
          "injected fault"
        );
        copy.clearFault();

        const result = await testVault(copy.storage).vault.unlock(password);
        expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
        expect(result.damagedKeyIds).toEqual([]);
        expect(await pubkeysOf(copy)).toEqual([...seeded.pubkeys].sort());
        expect(copy.maps.local.has("vaultRotation")).toBe(false);
      });
    }
  }
});

describe("recovery on other password paths", () => {
  it("re-authentication recovers a rotation whose commit failed in a live session", async () => {
    const seeded = await seededVault();
    seeded.env.failAt("local.set:encryptedKeys");
    await expect(seeded.vault.changePassword(OLD, NEW)).rejects.toThrow();
    seeded.env.clearFault();

    await seeded.vault.verifyPassword(NEW);

    expect(seeded.env.maps.local.has("vaultRotation")).toBe(false);
    const { result } = await unlockCopy(seeded.env.maps, NEW);
    expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
  });

  it("adding a key recovers first, so the new key survives", async () => {
    const seeded = await seededVault();
    seeded.env.failAt("local.set:encryptedKeys");
    await expect(seeded.vault.changePassword(OLD, NEW)).rejects.toThrow();
    seeded.env.clearFault();

    const added = await seeded.vault.importKey(
      "0000000000000000000000000000000000000000000000000000000000000004",
      NEW
    );

    const { result } = await unlockCopy(seeded.env.maps, NEW);
    expect(result.unlockedKeyIds).toContain(added.id);
    expect(result.unlockedKeyIds).toHaveLength(SECRETS.length + 1);
  });

  it("ignores a malformed journal rather than acting on it", async () => {
    const seeded = await seededVault();
    seeded.env.maps.local.set("vaultRotation", { from: 1, to: "x" });

    const { result } = await unlockCopy(seeded.env.maps, OLD);
    expect(result.unlockedKeyIds).toHaveLength(SECRETS.length);
  });
});

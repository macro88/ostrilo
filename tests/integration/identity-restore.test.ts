import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyRecord, SignedEvent } from "@/domain/types";
import type { StorageSuite } from "@/application/ports/storage";
import type { KeyVaultService } from "@/application/services/key-vault.service";
import { computeEventId } from "@/application/crypto/event-id";
import { NobleSchnorr, NobleSha256 } from "@/infrastructure/crypto/adapters";
import { hexToBytes } from "@/domain/utils/hex";
import {
  VaultRpcHandler,
  type KeyListEntry,
} from "@/infrastructure/messaging/handlers/vault-rpc";
import { lockedProjectionFor } from "@/infrastructure/messaging/rpc-router";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { memoryStorage, testVault } from "../helpers/vault";
import {
  SECRET_ONE,
  SECRET_TWO,
  STRONG_PASSWORD,
  dataOf,
  errorCodeOf,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * The identity a user had before a lock is the identity they get after the
 * next unlock.
 *
 * The defect was in what a surface was handed, not in storage: while locked,
 * `keys.list` returns identifiers only, and a surface that opened locked kept
 * that list after the unlock. These tests drive the same handlers the
 * extension routes to, over real services and real signatures, and compare
 * what a surface would read before the lock with what it reads after.
 */

const vaultRpc = new VaultRpcHandler();
const THIRD = "0000000000000000000000000000000000000000000000000000000000000003";

interface World {
  storage: StorageSuite;
  vault: KeyVaultService;
  context: ServiceContext;
  expectedSelectedId: string;
}

/** What a surface reads from the router: redacted while the vault is locked. */
async function listKeys(world: { vault: KeyVaultService; context: ServiceContext }) {
  const res = await vaultRpc.handleRequest({ type: "keys.list" }, world.context);
  const data = dataOf<KeyListEntry[]>(res);
  const locked = (await world.vault.getLockState()).isLocked;
  const redact = lockedProjectionFor("keys.list");
  return (locked && redact ? redact(data) : data) as KeyListEntry[];
}

async function lockStateOf(world: { vault: KeyVaultService }) {
  const state = await world.vault.getLockState();
  const redact = lockedProjectionFor("state.getLock");
  return (state.isLocked && redact ? redact(state) : state) as Awaited<
    ReturnType<KeyVaultService["getLockState"]>
  >;
}

/** A new worker over the same browser storage: memory is gone, storage is not. */
function restartWorker(world: World): World {
  const { vault } = testVault(world.storage);
  return { ...world, vault, context: { ...world.context, vault } };
}

async function signedBy(world: World, keyId?: string): Promise<SignedEvent> {
  const { pubkey } = (await world.vault.listKeys()).find(
    (k) => k.id === (keyId ?? world.expectedSelectedId)
  )!;
  return (await world.vault.signEvent(
    { pubkey, created_at: 1_700_000_000, kind: 1, tags: [], content: "hello" },
    keyId ?? world.expectedSelectedId
  )) as SignedEvent;
}

function verifies(event: SignedEvent): boolean {
  const id = computeEventId(NobleSha256, event);
  return (
    id === event.id &&
    NobleSchnorr.verify(hexToBytes(event.sig), hexToBytes(id), hexToBytes(event.pubkey))
  );
}

type Setup = (vault: KeyVaultService) => Promise<string>;

const VAULTS: Array<[string, Setup]> = [
  [
    "one generated key",
    async (vault) => (await vault.generateKey(STRONG_PASSWORD, "Generated")).id,
  ],
  [
    "one imported key",
    async (vault) => (await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "Imported")).id,
  ],
  [
    "three keys with the second selected",
    async (vault) => {
      await vault.importKey(SECRET_ONE, STRONG_PASSWORD, "First");
      const second = await vault.importKey(SECRET_TWO, STRONG_PASSWORD, "Second");
      await vault.importKey(THIRD, STRONG_PASSWORD, "Third");
      await vault.selectKey(second.id);
      return second.id;
    },
  ],
];

async function build(setup: Setup): Promise<World> {
  const { context, storage, vault } = realContext(memoryStorage());
  const expectedSelectedId = await setup(vault);
  return { storage, vault, context, expectedSelectedId };
}

describe.each(VAULTS)("a vault with %s", (_name, setup) => {
  let world: World;

  beforeEach(async () => {
    world = await build(setup);
    await world.vault.unlock(STRONG_PASSWORD);
  });

  it("returns the same keys, public keys and selection after a manual lock and unlock", async () => {
    const before = await listKeys(world);
    const selectedBefore = (await lockStateOf(world)).selectedKeyId;
    expect(selectedBefore).toBe(world.expectedSelectedId);
    const records = await world.vault.listKeys();

    await world.vault.lock();
    const whileLocked = await listKeys(world);
    expect(whileLocked).toEqual(before.map((k) => ({ id: k.id })));

    await world.vault.unlock(STRONG_PASSWORD);

    const after = await listKeys(world);
    expect(after.map((k) => [k.id, k.label, k.pubkey, k.npub])).toEqual(
      before.map((k) => [k.id, k.label, k.pubkey, k.npub])
    );
    expect((await lockStateOf(world)).selectedKeyId).toBe(selectedBefore);
    expect(await world.vault.listKeys()).toEqual(records);
  });

  it("restores the selection after the worker is restarted", async () => {
    const records = await world.vault.listKeys();
    const restarted = restartWorker(world);

    const evicted = await restarted.vault.getLockState();
    expect(evicted).toMatchObject({ isLocked: true, lockReason: "background_restarted" });
    expect(evicted.selectedKeyId).toBeUndefined();

    await restarted.vault.unlock(STRONG_PASSWORD);

    expect((await lockStateOf(restarted)).selectedKeyId).toBe(world.expectedSelectedId);
    const keys = await listKeys(restarted);
    expect(keys).toHaveLength(records.length);
    expect(keys.every((k) => typeof k.npub === "string" && k.npub.startsWith("npub1"))).toBe(true);
    expect(await restarted.vault.listKeys()).toEqual(records);
  });

  it("signs with the restored identity, and the signature verifies against its public key", async () => {
    await world.vault.lock();
    const restarted = restartWorker(world);
    await restarted.vault.unlock(STRONG_PASSWORD);

    const selectedId = (await lockStateOf(restarted)).selectedKeyId!;
    const stored = (await restarted.vault.listKeys()).find((k) => k.id === selectedId)!;
    const event = await signedBy(restarted, selectedId);

    expect(event.pubkey).toBe(stored.pubkey);
    expect(verifies(event)).toBe(true);
  });

  it("refuses to sign after a manual lock until the next unlock", async () => {
    await world.vault.lock();

    await expect(signedBy(world)).rejects.toThrow();

    await world.vault.unlock(STRONG_PASSWORD);
    expect(verifies(await signedBy(world))).toBe(true);
  });

  it("refuses to sign after an automatic lock until the next unlock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      await world.storage.local.set("appSettings", {
        __version: "settings.v1",
        autoLockMinutes: 5,
        selectedKeyId: world.expectedSelectedId,
      });
      await world.vault.unlock(STRONG_PASSWORD);

      vi.setSystemTime(start + 5 * 60_000 + 1);
      const state = await world.vault.getLockState();
      expect(state).toMatchObject({ isLocked: true, lockReason: "inactivity" });
      await expect(signedBy(world)).rejects.toThrow();

      await world.vault.unlock(STRONG_PASSWORD);
      expect(verifies(await signedBy(world))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selection that no longer exists", () => {
  it("falls back to the first key, and leaves every record as it was", async () => {
    const world = await build(VAULTS[2][1]);
    const records = await world.vault.listKeys();
    const settings = await world.storage.local.get<Record<string, unknown>>("appSettings");
    await world.storage.local.set("appSettings", { ...settings, selectedKeyId: "deleted-key" });

    await world.vault.unlock(STRONG_PASSWORD);

    expect((await lockStateOf(world)).selectedKeyId).toBe(records[0].id);
    expect(await world.vault.listKeys()).toEqual(records as KeyRecord[]);
  });

  it("creates no key when the password is wrong", async () => {
    const world = await build(VAULTS[0][1]);
    const records = await world.vault.listKeys();

    await expect(world.vault.unlock("not-the-password")).rejects.toThrow();

    expect(await world.vault.listKeys()).toEqual(records);
    expect((await world.vault.getLockState()).isLocked).toBe(true);
  });
});

describe("a selected key that could not be opened", () => {
  const SITE = "https://site.example";
  const KIND = 7;

  const signRequest = () => ({
    type: "nostr.signEvent" as const,
    origin: SITE,
    event: { kind: KIND, created_at: 1_700_000_000, tags: [], content: "hello" },
  });

  /** A healthy first key and a damaged second key that is the stored selection. */
  async function damagedSelection() {
    const world = await build(VAULTS[2][1]);
    const [healthy, damaged] = await world.vault.listKeys();
    const stored = await world.vault.listKeys();
    await world.storage.local.set(
      "encryptedKeys",
      stored.map((k) => (k.id === damaged.id ? { ...k, wrappedDek: undefined } : k))
    );
    await world.context.policy.setPerKindRule(SITE, KIND, "allow");
    await world.vault.unlock(STRONG_PASSWORD);
    return { world, healthy, damaged };
  }

  it("keeps the selection on that key, and does not fall back to the healthy one", async () => {
    const { world, damaged } = await damagedSelection();

    expect((await lockStateOf(world)).selectedKeyId).toBe(damaged.id);
    const listed = await listKeys(world);
    expect(listed.find((k) => k.id === damaged.id)?.unreadable).toBe(true);
    expect(listed.filter((k) => k.unreadable)).toHaveLength(1);
  });

  it("refuses to sign instead of signing as another identity, then signs once the healthy key is chosen", async () => {
    const { world, healthy, damaged } = await damagedSelection();
    const nostr = new NostrRpcHandler(undefined, async () => 1);

    expect(errorCodeOf(await nostr.handleRequest(signRequest(), world.context))).toBe(
      RPC_ERROR_CODES.VAULT_UNREADABLE
    );
    await expect(world.vault.sign("ab".repeat(32), damaged.id)).rejects.toThrow("key_unreadable");

    await world.vault.selectKey(healthy.id);
    const signed = dataOf<{ event: SignedEvent }>(
      await nostr.handleRequest(signRequest(), world.context)
    ).event;

    expect(signed.pubkey).toBe(healthy.pubkey);
    expect(verifies(signed)).toBe(true);
  });

  it("does not disclose the public key of a key that cannot sign", async () => {
    const { world } = await damagedSelection();
    const nostr = new NostrRpcHandler(undefined, async () => 1);

    const res = await nostr.handleRequest(
      { type: "nostr.getPublicKey", origin: SITE },
      world.context
    );

    expect(errorCodeOf(res)).toBe(RPC_ERROR_CODES.VAULT_UNREADABLE);
  });

  it("clears the unreadable mark on lock, and leaves every record as it was", async () => {
    const { world, damaged } = await damagedSelection();
    const records = await world.vault.listKeys();

    await world.vault.lock();

    expect(world.vault.isKeyUnreadable(damaged.id)).toBe(false);
    expect(await world.vault.listKeys()).toEqual(records);
  });
});

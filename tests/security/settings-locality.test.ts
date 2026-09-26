import { afterEach, describe, expect, it, vi } from "vitest";

// The approval path opens a window and sets the badge; neither is under test.
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://ostrilo-test${path}`,
      sendMessage: async () => undefined,
    },
    windows: { create: async () => ({ id: 1 }) },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
  },
}));
import { collectSources, SRC } from "../helpers/source-scan";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { ApprovalQueueService } from "@/application/services/approval-queue.service";
import { SETTINGS_STORAGE_KEY } from "@/application/services/settings-store";
import type { AppSettingsV1, OriginPolicy } from "@/domain/types";
import { memoryStorage } from "../helpers/vault";
import {
  SECRET_ONE,
  STRONG_PASSWORD,
  realContext,
} from "../unit/infrastructure/messaging-fixture";

/**
 * Settings that grant authority used to live in `storage.sync`, which the
 * browser copies to every profile on the account. A grant made on one device
 * under that device's password took effect on every other synced browser
 * without it - so anyone holding the browser account could install Ostrilo,
 * grant their own site `high` trust with a throwaway vault, and have it sign
 * silently on the victim's devices. The settings item is now device-local.
 */

/**
 * The only files allowed to name synced storage, and why:
 * - `settings-store.ts` reads and removes the pre-upgrade copy to migrate it;
 * - `useWxtStorage.ts` and `background.ts` read and write the docked-panel
 *   flag, which can do nothing but move the UI;
 * - the storage adapter builds the area itself.
 */
const SYNC_ALLOWLIST = new Set([
  "src/application/services/settings-store.ts",
  "src/ui/hooks/useWxtStorage.ts",
  "src/extension/background.ts",
  "src/infrastructure/storage/adapters.ts",
]);

describe("static boundary", () => {
  const sources = collectSources(SRC);

  it("names synced storage only in the allowlisted files", () => {
    const offenders = sources
      .filter((f) => /\bstorage\s*\.\s*sync\b|createArea\(\s*["']sync["']/.test(f.code))
      .map((f) => f.path)
      .filter((p) => !SYNC_ALLOWLIST.has(p));
    expect(
      offenders,
      `SECURITY REGRESSION: these files reach browser-synced storage: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("uses synced storage in background.ts only for the docked-panel flag", () => {
    const background = sources.find((f) => f.path === "src/extension/background.ts");
    const lines = (background?.code ?? "")
      .split("\n")
      .filter((l) => /\bstorage\s*\.\s*sync\b/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain("DOCKED_STORAGE_KEY");
  });

  it("names the settings storage key only inside the settings store", () => {
    const offenders = sources
      .filter((f) => /["'`]appSettings["'`]/.test(f.code))
      .map((f) => f.path)
      .filter((p) => p !== "src/application/services/settings-store.ts");
    expect(
      offenders,
      `a second owner of the settings key decides its own storage area: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});

/** A storage suite whose synced area records every write and removal. */
function watchedStorage() {
  const storage = memoryStorage();
  const syncWrites: string[] = [];
  const realSet = storage.sync.set.bind(storage.sync);
  const realRemove = storage.sync.remove.bind(storage.sync);
  storage.sync.set = async <T>(key: string, value: T) => {
    syncWrites.push(`set:${key}`);
    return realSet(key, value);
  };
  storage.sync.remove = async (key: string) => {
    syncWrites.push(`remove:${key}`);
    return realRemove(key);
  };
  return { storage, syncWrites };
}

describe("runtime boundary", () => {
  const EVIL = "https://evil.example";
  let queue: ApprovalQueueService;

  afterEach(() => queue?.clear());

  it("writes a trust grant to local storage only", async () => {
    const { storage, syncWrites } = watchedStorage();
    const { context, vault } = realContext(storage);
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);

    const res = await new PolicyRpcHandler().handleRequest(
      {
        type: "policy.setOrigin",
        origin: EVIL,
        patch: { trustLevel: "high" },
        password: STRONG_PASSWORD,
      },
      context
    );

    expect(res.ok, JSON.stringify(res)).toBe(true);
    const local = await storage.local.get<AppSettingsV1>(SETTINGS_STORAGE_KEY);
    expect(local?.origins.find((o) => o.origin === EVIL)?.trustLevel).toBe("high");
    expect(syncWrites, "SECURITY REGRESSION: a grant was written to browser sync").toEqual([]);
  });

  it("writes nothing to synced storage when the vault locks", async () => {
    const { storage, syncWrites } = watchedStorage();
    const { vault, policy } = realContext(storage);
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);
    await policy.setOriginPolicy(EVIL, { trustLevel: "low" });

    await vault.lock();

    expect(syncWrites).toEqual([]);
  });

  it("gives a synced grant no effect after migration", async () => {
    const { storage } = watchedStorage();
    const { context, vault, settings } = realContext(storage);
    await vault.importKey(SECRET_ONE, STRONG_PASSWORD);
    await vault.unlock(STRONG_PASSWORD);
    await settings.get();

    // What another device on the account - or its attacker - can plant.
    const planted: OriginPolicy = {
      origin: EVIL,
      trustLevel: "high",
      rules: { 7: "allow" },
      identityDisclosure: "allow",
      updatedAt: 1,
    };
    const current = (await settings.get()) as AppSettingsV1;
    await storage.sync.set(SETTINGS_STORAGE_KEY, { ...current, origins: [planted] });

    queue = new ApprovalQueueService();
    const nostr = new NostrRpcHandler(queue, async () => 1);

    void nostr.handleRequest({ type: "nostr.getPublicKey", origin: EVIL }, context);
    const signing = nostr.handleRequest(
      {
        type: "nostr.signEvent",
        origin: EVIL,
        event: { kind: 7, content: "+", tags: [], created_at: 1 },
      },
      context
    );

    await expect.poll(() => queue.count()).toBe(2);
    expect(queue.getAllPending().map((p) => p.operation).sort()).toEqual([
      "identity_disclosure",
      "sign_event",
    ]);
    expect(await context.policy.getIdentityDisclosure(EVIL)).toBeUndefined();

    queue.clear();
    const signed = await signing;
    expect(signed.ok, "SECURITY REGRESSION: a synced grant signed without approval").toBe(false);
  });
});

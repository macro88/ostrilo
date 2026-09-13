import { describe, it, expect, beforeEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";

/**
 * Auto-lock, and the lock state it depends on.
 *
 * Two defects, both shipped:
 *
 *  1. `getLockState` was `isLocked: !!state?.isLocked`. With no stored state -
 *     the situation after every browser restart, before anything is unlocked -
 *     `!!undefined` is false, so the vault reported itself UNLOCKED.
 *     `nostr.getPublicKey` checks only this gate, so a never-opened vault
 *     disclosed the user's Nostr identity to any page.
 *  2. `autoLockMinutes` was cosmetic. It defaulted to 15, drove two sliders and
 *     rendered "Unlocked - 15m" in the header, and nothing enforced it: no
 *     chrome.alarms usage anywhere, no browser.idle, no timer calling lock().
 *     The only call to lock() in the codebase was the manual button. The README
 *     advertised the feature regardless.
 */

const PASSWORD = "unmark thicket parcel";

function memoryStorage() {
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

const fastKdf = {
  async deriveKey(password: string, params: never) {
    const p = params as unknown as { salt: number[] };
    return VaultKdf.deriveKey(password, {
      alg: "pbkdf2-sha256",
      c: 600_000,
      salt: p.salt,
    });
  },
};

describe("lock state fails closed", () => {
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;

  beforeEach(() => {
    ({ suite, maps } = memoryStorage());
    vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
  });

  it("reports LOCKED when session storage holds nothing", async () => {
    const state = await vault.getLockState();
    expect(
      state.isLocked,
      "SECURITY REGRESSION: an absent lock record reported the vault unlocked"
    ).toBe(true);
  });

  it("reports LOCKED for malformed stored state", async () => {
    for (const bad of [null, 42, "unlocked", {}, { isLocked: "no" }]) {
      maps.session.set("lockState", bad);
      expect(
        (await vault.getLockState()).isLocked,
        `malformed state ${JSON.stringify(bad)} must report locked`
      ).toBe(true);
    }
  });

  it("reports LOCKED when the storage read throws", async () => {
    const throwing = {
      ...suite,
      session: {
        async get(): Promise<never> {
          throw new Error("storage unavailable");
        },
        async set(): Promise<void> {},
        async remove(): Promise<void> {},
      },
    } as unknown as StorageSuite;
    const v = new KeyVaultService(
      throwing,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
    expect((await v.getLockState()).isLocked).toBe(true);
  });

  it("reports LOCKED when the record says unlocked but no keys are in memory", async () => {
    // This is every MV3 worker eviction. The old code reported an unlocked
    // vault with an empty key map, and the next signature failed with a
    // confusing "denied" instead of "locked".
    await vault.generateKey(PASSWORD, "k1");
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).isLocked).toBe(false);

    // A fresh service instance over the same storage == worker restart.
    const restarted = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
    expect(
      (await restarted.getLockState()).isLocked,
      "a restarted worker holds no keys, so the vault is locked"
    ).toBe(true);

    // And the stored record is corrected rather than left disagreeing.
    expect(
      (maps.session.get("lockState") as { isLocked: boolean }).isLocked
    ).toBe(true);
  });

  it("refuses to unlock an empty vault and writes no unlocked state", async () => {
    // An empty vault has nothing to verify a password against. Reporting
    // success here would have written isLocked: false with an empty key
    // map - an "unlocked" vault that any password opens.
    await expect(vault.unlock(PASSWORD)).rejects.toThrow("vault_not_created");
    expect(maps.session.get("lockState")).toBeUndefined();
    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("reports unlocked only after a real unlock", async () => {
    await vault.generateKey(PASSWORD, "k1");
    expect((await vault.getLockState()).isLocked).toBe(true);
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).isLocked).toBe(false);
  });
});

describe("auto-lock deadline", () => {
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;

  beforeEach(async () => {
    ({ suite, maps } = memoryStorage());
    vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
    await vault.generateKey(PASSWORD, "k1");
  });

  async function setTimeout_(minutes: number) {
    maps.sync.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: minutes,
    });
  }

  it("locks once the configured timeout has elapsed", async () => {
    await setTimeout_(15);
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).isLocked).toBe(false);

    // Rewind lastActivity past the deadline.
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 16 * 60 * 1000,
    });

    expect(
      (await vault.getLockState()).isLocked,
      "SECURITY REGRESSION: the configured auto-lock timeout was not enforced"
    ).toBe(true);
  });

  it("zeroizes key material when the deadline locks the vault", async () => {
    await setTimeout_(1);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 5 * 60 * 1000,
    });

    await vault.getLockState();
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow();
  });

  it("treats a future timestamp as expired rather than as a long lease", async () => {
    await setTimeout_(15);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() + 10 * 60 * 60 * 1000,
    });
    expect(
      (await vault.getLockState()).isLocked,
      "a clock change must not be able to extend a session"
    ).toBe(true);
  });

  it("does not lock while activity keeps the deadline fresh", async () => {
    await setTimeout_(15);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 14 * 60 * 1000,
    });
    expect((await vault.getLockState()).isLocked).toBe(false);

    await vault.touchActivity();
    expect((await vault.getLockState()).isLocked).toBe(false);
  });

  it("never revives a locked vault through touchActivity", async () => {
    await setTimeout_(15);
    await vault.unlock(PASSWORD);
    await vault.lock();

    await vault.touchActivity();

    expect(
      (await vault.getLockState()).isLocked,
      "polling or touching from a locked UI must not reopen the vault"
    ).toBe(true);
  });

  it("treats a stored zero as the shipped default, not as never-lock", async () => {
    // 0 used to mean "do not auto-lock". Combined with a lock state that
    // already failed open, that left a vault unlocked indefinitely. Every
    // read of the setting now normalizes it.
    await setTimeout_(0);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - (AUTO_LOCK_BOUNDS.default + 1) * 60 * 1000,
    });
    expect(
      (await vault.getLockState()).isLocked,
      "SECURITY REGRESSION: a stored 0 disabled auto-lock"
    ).toBe(true);
  });

  it("clamps a stored value above the ceiling", async () => {
    await setTimeout_(10_000);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - (AUTO_LOCK_BOUNDS.max + 1) * 60 * 1000,
    });
    expect(
      (await vault.getLockState()).isLocked,
      "a settings write must not be able to buy an unbounded session"
    ).toBe(true);
  });
});

describe("no secret survives worker termination", () => {
  it("persists no key material, password or derived key to storage", async () => {
    const { suite, maps } = memoryStorage();
    const vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
    await vault.generateKey(PASSWORD, "k1");
    await vault.unlock(PASSWORD);

    for (const [area, m] of Object.entries(maps)) {
      const dump = JSON.stringify([...m.entries()]);
      expect(dump, `${area} must not contain the password`).not.toContain(
        PASSWORD
      );
    }

    // Session storage holds lock bookkeeping only - never keys.
    const session = JSON.stringify([...maps.session.entries()]);
    expect(session).not.toContain("nsec");
    expect(Object.keys(Object.fromEntries(maps.session))).toEqual(["lockState"]);
  });
});

describe("a locked vault reports locked, not denied", () => {
  it("classifies both vault errors that mean the key is unavailable", async () => {
    const { isVaultLockedError } = await import(
      "@/infrastructure/messaging/handlers/nostr-rpc"
    );
    expect(isVaultLockedError("no_unlocked_key")).toBe(true);
    expect(isVaultLockedError("key_locked_or_missing")).toBe(true);
    // Not everything is a lock. A genuine refusal must stay a refusal.
    expect(isVaultLockedError("hash_must_be_32_bytes")).toBe(false);
    expect(isVaultLockedError(undefined)).toBe(false);
  });

  it("throws exactly those strings from the vault, so the mapping holds", async () => {
    // Pins the two ends together. If the vault renames its error, the handler
    // silently reverts to reporting `denied` and only this test notices.
    const { suite } = memoryStorage();
    const vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr
    );
    const { VAULT_LOCKED_ERRORS } = await import(
      "@/infrastructure/messaging/handlers/nostr-rpc"
    );

    // Nothing selected and nothing unlocked.
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow(
      new RegExp(VAULT_LOCKED_ERRORS.join("|"))
    );

    // A key exists and is selected, but the vault is locked.
    await vault.generateKey(PASSWORD, "k1");
    await vault.unlock(PASSWORD);
    await vault.lock();
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow(
      new RegExp(VAULT_LOCKED_ERRORS.join("|"))
    );
  });
});

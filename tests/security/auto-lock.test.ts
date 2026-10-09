import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AutoSignBudgetService } from "@/application/services/auto-sign-budget.service";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";
import { StateRpcHandler } from "@/infrastructure/messaging/handlers/state-rpc";
import { NostrRpcHandler } from "@/infrastructure/messaging/handlers/nostr-rpc";
import {
  UserPresenceService,
  type IdleState,
} from "@/application/services/user-presence.service";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";

/**
 * Auto-lock, and the lock state it depends on.
 *
 * Two defects, both shipped:
 *
 *  1. `getLockState` was `isLocked: !!state?.isLocked`. With no stored state -
 *     the situation after every browser restart, before anything is unlocked -
 *     `!!undefined` is false, so the vault reported itself UNLOCKED.
 *     At the time, `nostr.getPublicKey` checked only this gate, so a
 *     never-opened vault disclosed the user's Nostr identity to any page.
 *     That is no longer the whole story: the method now also validates the
 *     calling origin, is rate limited per origin, and writes an activity-log
 *     entry for every outcome.
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
      NobleSchnorr,
      NobleSha256,
      ScureBech32
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
      NobleSchnorr,
      NobleSha256,
      ScureBech32
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
      NobleSchnorr,
      NobleSha256,
      ScureBech32
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
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    await vault.generateKey(PASSWORD, "k1");
  });

  async function setTimeout_(minutes: number) {
    maps.local.set("appSettings", {
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

describe("the reported deadline", () => {
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;

  beforeEach(async () => {
    ({ suite, maps } = memoryStorage());
    vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    await vault.generateKey(PASSWORD, "k1");
  });

  function setTimeout_(minutes: number) {
    maps.local.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: minutes,
    });
  }

  function lastActivity(): number {
    return (maps.session.get("lockState") as { lastActivity: number })
      .lastActivity;
  }

  it("reports the deadline while unlocked", async () => {
    setTimeout_(15);
    await vault.unlock(PASSWORD);

    const state = await vault.getLockState();
    expect(state.isLocked).toBe(false);
    expect(state.lockAt).toBe(lastActivity() + 15 * 60 * 1000);
  });

  it("withholds the deadline while locked", async () => {
    setTimeout_(15);
    await vault.unlock(PASSWORD);
    await vault.lock();

    const state = await vault.getLockState();
    expect(state.isLocked).toBe(true);
    expect(
      state.lockAt,
      "a locked response must not disclose when the session would have ended"
    ).toBeUndefined();
  });

  it("withholds the deadline on the path where the deadline itself locked", async () => {
    setTimeout_(15);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 16 * 60 * 1000,
    });

    const state = await vault.getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockAt).toBeUndefined();
  });

  it("withholds the deadline on the worker-eviction correction", async () => {
    setTimeout_(15);
    await vault.unlock(PASSWORD);

    // A fresh service over the same storage holds no keys: worker eviction.
    const restarted = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    const state = await restarted.getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockAt).toBeUndefined();
  });

  it("recomputes the deadline after a timeout change", async () => {
    setTimeout_(30);
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).lockAt).toBe(
      lastActivity() + 30 * 60 * 1000
    );

    setTimeout_(5);
    expect(
      (await vault.getLockState()).lockAt,
      "the reported deadline must follow the stored timeout, not the one in force at unlock"
    ).toBe(lastActivity() + 5 * 60 * 1000);
  });

  it("moves the reported deadline with recorded activity", async () => {
    setTimeout_(15);
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 10 * 60 * 1000,
    });
    const before = (await vault.getLockState()).lockAt ?? 0;

    await vault.touchActivity();

    expect((await vault.getLockState()).lockAt ?? 0).toBeGreaterThan(before);
  });

  it("reports a deadline that agrees with enforcement", async () => {
    // The number shown and the number applied come from one formula, so the
    // vault must not still report unlocked one millisecond past what it said.
    setTimeout_(15);
    await vault.unlock(PASSWORD);
    const deadline = (await vault.getLockState()).lockAt ?? 0;

    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: (s.lastActivity as number) - (deadline - Date.now()) - 1,
    });

    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("normalizes the stored timeout before reporting it", async () => {
    // A stored 0 once meant never-lock. The reported deadline must use the
    // same normalized value enforcement uses, or the ring would promise a
    // session the vault will not honour.
    setTimeout_(0);
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).lockAt).toBe(
      lastActivity() + AUTO_LOCK_BOUNDS.default * 60 * 1000
    );
  });
});

describe("activity recorded through the state.touch RPC", () => {
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;
  let handler: StateRpcHandler;

  /** The handler's whole dependency here is the vault; the rest is unreached. */
  function context(): ServiceContext {
    return { vault } as unknown as ServiceContext;
  }

  async function touchOverRpc() {
    return handler.handleRequest({ type: "state.touch" }, context());
  }

  beforeEach(async () => {
    ({ suite, maps } = memoryStorage());
    vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    handler = new StateRpcHandler();
    maps.local.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: 15,
    });
    await vault.generateKey(PASSWORD, "k1");
  });

  it("slides the deadline when a surface reports activity", async () => {
    // The gap this change closes: `state.touch` was reachable and correct,
    // and no surface called it, so the deadline ran from unlock and never
    // moved - while the shipped slider copy promised it moved with activity.
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 14 * 60 * 1000,
    });
    const before = (await vault.getLockState()).lockAt ?? 0;

    const res = await touchOverRpc();

    expect(res.ok).toBe(true);
    const after = (await vault.getLockState()).lockAt ?? 0;
    expect(after).toBeGreaterThan(before);
    // Postponed by roughly the whole window, not by some fraction of it.
    expect(after - Date.now()).toBeGreaterThan(14 * 60 * 1000);
  });

  it("does not revive a locked vault", async () => {
    await vault.unlock(PASSWORD);
    await vault.lock();

    const res = await touchOverRpc();

    // The call is served - it is on the locked-reachable list - but it is a
    // no-op, so a locked UI cannot hold a session open by reporting activity.
    expect(res.ok).toBe(true);
    const state = await vault.getLockState();
    expect(
      state.isLocked,
      "SECURITY REGRESSION: state.touch reopened a locked vault"
    ).toBe(true);
    expect(state.lockAt).toBeUndefined();
  });

  it("does not revive a vault that locked because the deadline passed", async () => {
    await vault.unlock(PASSWORD);
    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 16 * 60 * 1000,
    });

    await touchOverRpc();

    expect(
      (await vault.getLockState()).isLocked,
      "an expired deadline must not be extendable by a late activity report"
    ).toBe(true);
  });

  it("locks an idle surface on schedule with the reporter wired up", async () => {
    // The countdown renders and the poll runs on an open surface; neither
    // reports activity. With no deliberate action, the vault still locks.
    await vault.unlock(PASSWORD);

    // Five minutes of an open surface polling lock state, and nothing else.
    for (let i = 0; i < 60; i++) {
      expect((await vault.getLockState()).isLocked).toBe(false);
    }

    const s = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...s,
      lastActivity: Date.now() - 15 * 60 * 1000,
    });

    expect(
      (await vault.getLockState()).isLocked,
      "polling an open surface must not postpone the lock"
    ).toBe(true);
  });
});

describe("a signature postpones the lock only when someone is there", () => {
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;
  let handler: NostrRpcHandler;
  let idle: IdleState;
  let idleQueries: number;
  let presence: UserPresenceService;
  let clock: number;

  const ORIGIN = "https://nostrich.example";

  /** Kind 7 is a reaction: unprotected, so `allow` signs it with no prompt. */
  function reaction(content = "+") {
    return {
      type: "nostr.signEvent",
      origin: ORIGIN,
      event: {
        kind: 7,
        content,
        tags: [],
        created_at: Math.floor(clock / 1000),
      },
    } as never;
  }

  function context(): ServiceContext {
    return {
      vault,
      presence,
      policy: { async evaluate() { return { mode: "allow" }; } },
      activityLog: { async addEntry() {} },
      autoSignBudget: new AutoSignBudgetService(),
    } as unknown as ServiceContext;
  }

  async function react() {
    return handler.handleRequest(reaction(), context());
  }

  async function deadline(): Promise<number> {
    return (await vault.getLockState()).lockAt ?? 0;
  }

  /** Moves the recorded activity back, as if the user had done nothing since. */
  async function ageSessionBy(ms: number) {
    const state = maps.session.get("lockState") as Record<string, unknown>;
    maps.session.set("lockState", {
      ...state,
      lastActivity: (state.lastActivity as number) - ms,
    });
  }

  beforeEach(async () => {
    ({ suite, maps } = memoryStorage());
    clock = 1_735_689_600_000;
    idle = "active";
    idleQueries = 0;
    vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    handler = new NostrRpcHandler();
    maps.local.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: 5,
    });
    presence = new UserPresenceService(
      { async get() { return maps.local.get("appSettings") as never; } } as never,
      async () => {
        idleQueries++;
        return idle;
      },
      () => clock
    );
    await vault.generateKey(PASSWORD, "k1");
    await vault.unlock(PASSWORD);
  });

  it("postpones the lock when the user is at the machine", async () => {
    await ageSessionBy(4 * 60 * 1000);
    const before = await deadline();

    const res = await react();

    expect(res.ok).toBe(true);
    expect(await deadline()).toBeGreaterThan(before);
  });

  it("does not postpone the lock when the user is idle", async () => {
    await ageSessionBy(4 * 60 * 1000);
    idle = "idle";
    const before = await deadline();

    const res = await react();

    // The signature is still produced - the vault was open and policy allowed
    // it. What it does not buy is more time.
    expect(res.ok).toBe(true);
    expect(
      await deadline(),
      "SECURITY REGRESSION: a page held an unattended vault open"
    ).toBe(before);
  });

  it("does not postpone the lock behind an operating-system lock screen", async () => {
    await ageSessionBy(4 * 60 * 1000);
    idle = "locked";
    const before = await deadline();

    await react();

    expect(await deadline()).toBe(before);
  });

  it("lets a reader react, read, and react again without being locked out", async () => {
    // The defect this whole change exists for. Reacting is kind 7, which is
    // signed with no prompt, so a user working through a feed generates no
    // interaction the extension counts - and used to get locked out mid-read.
    expect((await react()).ok).toBe(true);

    // Four minutes of reading against a five-minute timeout. The user is at
    // the machine - scrolling a feed is input - so presence holds.
    clock += 4 * 60 * 1000;
    await ageSessionBy(4 * 60 * 1000);

    const second = await react();

    expect(second.ok, "the second reaction must not fail").toBe(true);
    expect((await vault.getLockState()).isLocked).toBe(false);
  });

  it("locks anyway once the reader walks away", async () => {
    idle = "idle";

    // A client publishing on a timer, once a minute, for the whole window.
    for (let minute = 0; minute < 5; minute++) {
      await react();
      clock += 60 * 1000;
      await ageSessionBy(60 * 1000);
    }

    expect(
      (await vault.getLockState()).isLocked,
      "SECURITY REGRESSION: a signing origin held the vault open across an idle window"
    ).toBe(true);

    const refused = await react();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect((refused.error as { data: { errorCode: string } }).data.errorCode).toBe(
        RPC_ERROR_CODES.LOCKED
      );
    }
  });

  it("collapses a burst of signatures to one idle query and one postponement", async () => {
    await ageSessionBy(4 * 60 * 1000);
    const before = await deadline();

    for (let i = 0; i < 20; i++) await react();

    expect(idleQueries, "a signing loop must not drive one idle query per event").toBe(1);
    const after = await deadline();
    expect(after).toBeGreaterThan(before);

    // And the throttled ones did not each push it further.
    clock += 1;
    expect(await deadline()).toBe(after);
  });
});

describe("no secret survives worker termination", () => {
  it("persists no key material, password or derived key to storage", async () => {
    const { suite, maps } = memoryStorage();
    const vault = new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
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
      NobleSchnorr,
      NobleSha256,
      ScureBech32
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

const MINUTE_MS = 60 * 1000;

describe("a 35 minute timeout on a deterministic clock", () => {
  const T0 = 1_760_000_000_000;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;

  function newVault(suite: StorageSuite) {
    return new KeyVaultService(
      suite,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
  }

  function setTimeoutMinutes(minutes: number) {
    maps.local.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: minutes,
    });
  }

  beforeEach(async () => {
    // Only Date is faked: the KDF and WebCrypto run on real time.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    let suite: StorageSuite;
    ({ suite, maps } = memoryStorage());
    vault = newVault(suite);
    await vault.generateKey(PASSWORD, "k1");
    setTimeoutMinutes(35);
    vi.setSystemTime(T0);
    await vault.unlock(PASSWORD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is 2,100,000 ms from the last activity", async () => {
    const state = await vault.getLockState();
    expect(state.lockAt).toBe(T0 + 2_100_000);
  });

  it("does not lock one second before the deadline and locks at it", async () => {
    vi.setSystemTime(T0 + 2_099_000);
    expect((await vault.getLockState()).isLocked).toBe(false);

    vi.setSystemTime(T0 + 2_099_999);
    expect((await vault.getLockState()).isLocked).toBe(false);

    vi.setSystemTime(T0 + 2_100_000);
    expect(
      (await vault.getLockState()).isLocked,
      "the vault must lock exactly at the 35 minute deadline"
    ).toBe(true);
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow();
  });

  it("measures from the last activity, not from the unlock", async () => {
    vi.setSystemTime(T0 + 30 * MINUTE_MS);
    await vault.touchActivity();

    vi.setSystemTime(T0 + 64 * MINUTE_MS + 59_000);
    expect((await vault.getLockState()).isLocked).toBe(false);
    vi.setSystemTime(T0 + 65 * MINUTE_MS);
    expect((await vault.getLockState()).isLocked).toBe(true);
  });

  it("applies a shortened timeout to the session already running", async () => {
    vi.setSystemTime(T0 + 10 * MINUTE_MS);
    expect((await vault.getLockState()).isLocked).toBe(false);

    setTimeoutMinutes(5);

    expect(
      (await vault.getLockState()).isLocked,
      "the old 35 minute deadline must not outlive the new 5 minute setting"
    ).toBe(true);
  });

  it("applies a lengthened timeout to the session already running", async () => {
    setTimeoutMinutes(5);
    vi.setSystemTime(T0 + 4 * MINUTE_MS);
    expect((await vault.getLockState()).isLocked).toBe(false);

    setTimeoutMinutes(35);

    vi.setSystemTime(T0 + 6 * MINUTE_MS);
    const state = await vault.getLockState();
    expect(state.isLocked).toBe(false);
    expect(state.lockAt).toBe(T0 + 35 * MINUTE_MS);
  });

  it("starts a fresh deadline at every unlock", async () => {
    vi.setSystemTime(T0 + 30 * MINUTE_MS);
    await vault.lock();
    await vault.unlock(PASSWORD);

    expect((await vault.getLockState()).lockAt).toBe(T0 + 65 * MINUTE_MS);
    vi.setSystemTime(T0 + 36 * MINUTE_MS);
    expect(
      (await vault.getLockState()).isLocked,
      "the first session's deadline must not lock the second"
    ).toBe(false);
  });

  it("stores the setting as whole minutes and reads 35 back as 35", async () => {
    // The brief's unit/parse hypothesis: nothing between the slider and the
    // deadline may rescale the value.
    const { normalizeAutoLockMinutes } = await import("@/domain/types");
    expect(normalizeAutoLockMinutes(35)).toBe(35);
    expect(normalizeAutoLockMinutes("35")).toBe(AUTO_LOCK_BOUNDS.default);
    expect(AUTO_LOCK_BOUNDS.max).toBeGreaterThanOrEqual(35);
  });
});

describe("why the vault is locked", () => {
  const T0 = 1_760_000_000_000;
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];
  let vault: KeyVaultService;

  function newVault(s: StorageSuite) {
    return new KeyVaultService(
      s,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
  }

  function recordedState() {
    return maps.session.get("lockState") as Record<string, unknown>;
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    ({ suite, maps } = memoryStorage());
    vault = newVault(suite);
    await vault.generateKey(PASSWORD, "k1");
    maps.local.set("appSettings", {
      __version: "settings.v1",
      autoLockMinutes: 35,
    });
    await vault.unlock(PASSWORD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing before the vault has ever been unlocked", async () => {
    const fresh = memoryStorage();
    const state = await newVault(fresh.suite).getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBeUndefined();
  });

  it("reports an unlocked vault with no reason", async () => {
    const state = await vault.getLockState();
    expect(state.isLocked).toBe(false);
    expect(state.lockReason).toBeUndefined();
  });

  it("records a manual lock", async () => {
    await vault.lock();
    expect(await vault.getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "manual",
    });
  });

  it("records the inactivity timeout with the minutes it elapsed", async () => {
    vi.setSystemTime(T0 + 35 * MINUTE_MS);
    expect(await vault.getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "inactivity",
      inactivityMinutes: 35,
    });
    // Stored, so the next read - a surface opened later - says the same.
    expect(await vault.getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "inactivity",
      inactivityMinutes: 35,
    });
  });

  it("records a worker that restarted while the state said unlocked", async () => {
    const restarted = newVault(suite);
    expect(await restarted.getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "background_restarted",
    });
    expect(recordedState().lockReason).toBe("background_restarted");
    expect(await restarted.getLockState()).toMatchObject({
      lockReason: "background_restarted",
    });
  });

  it("records a state that cannot be read", async () => {
    for (const bad of [null, 42, "unlocked", {}, { isLocked: "no" }]) {
      maps.session.set("lockState", bad);
      expect(await vault.getLockState()).toMatchObject({
        isLocked: true,
        lockReason: "state_unreadable",
      });
    }
  });

  it("records a storage read that throws", async () => {
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
    expect(await newVault(throwing).getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "state_unreadable",
    });
  });

  it("locks, and says why, when the recorded activity is not a usable time", async () => {
    for (const lastActivity of [Number.NaN, "yesterday", undefined, 0, -5]) {
      await vault.unlock(PASSWORD);
      maps.session.set("lockState", { ...recordedState(), lastActivity });
      expect(
        await vault.getLockState(),
        `lastActivity ${String(lastActivity)} must fail closed`
      ).toMatchObject({ isLocked: true, lockReason: "state_unreadable" });
    }
  });

  it("records a clock that moved back past the last activity", async () => {
    maps.session.set("lockState", {
      ...recordedState(),
      lastActivity: T0 + 10 * 60 * MINUTE_MS,
    });
    expect(await vault.getLockState()).toMatchObject({
      isLocked: true,
      lockReason: "clock_rollback",
    });
    await expect(vault.sign("ab".repeat(32))).rejects.toThrow();
  });

  it("forgets the reason at the next unlock", async () => {
    await vault.lock();
    await vault.unlock(PASSWORD);
    const state = await vault.getLockState();
    expect(state.isLocked).toBe(false);
    expect(state.lockReason).toBeUndefined();
    expect(recordedState()).not.toHaveProperty("lockReason");
  });

  it("ignores a stored reason it does not recognise", async () => {
    await vault.lock();
    maps.session.set("lockState", { ...recordedState(), lockReason: "<b>x</b>" });
    const state = await vault.getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBeUndefined();
  });

  it("keeps the reason a label: no key material rides with it", async () => {
    vi.setSystemTime(T0 + 35 * MINUTE_MS);
    await vault.getLockState();
    expect(Object.keys(recordedState()).sort()).toEqual(
      ["inactivityMinutes", "isLocked", "lastActivity", "lockReason", "selectedKeyId"].sort()
    );
  });
});

describe("lock reasons stay truthful under races and damage", () => {
  const T0 = 1_760_000_000_000;
  let suite: StorageSuite;
  let maps: ReturnType<typeof memoryStorage>["maps"];

  function newVault(s: StorageSuite) {
    return new KeyVaultService(
      s,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    ({ suite, maps } = memoryStorage());
    const first = newVault(suite);
    await first.generateKey(PASSWORD, "k1");
    await first.unlock(PASSWORD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a manual lock that lands while a restart check is in flight keeps its reason", async () => {
    // A fresh instance over an unlocked record is a restarted worker: it holds
    // no keys, so a read of the lock state wants to record background_restarted.
    // Hold that read at its settings fetch while the user locks.
    const restarted = newVault(suite);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const localGet = suite.local.get.bind(suite.local);
    let held = false;
    (suite.local as { get: typeof suite.local.get }).get = (async (key: string) => {
      if (key === "appSettings" && !held) {
        held = true;
        await gate;
      }
      return localGet(key);
    }) as typeof suite.local.get;

    const inFlight = restarted.getLockState();
    await Promise.resolve();
    await restarted.lock();
    release();
    const result = await inFlight;

    expect(result).toMatchObject({ isLocked: true, lockReason: "manual" });
    expect(
      (maps.session.get("lockState") as { lockReason?: string }).lockReason,
      "a manual lock was overwritten with background_restarted"
    ).toBe("manual");
  });

  it("an unlock that opens no key reports the vault locked, with no false reason", async () => {
    const records = maps.local.get("encryptedKeys") as Array<Record<string, unknown>>;
    maps.local.set("encryptedKeys", [{ ...records[0], pubkey: "cd".repeat(32) }]);
    const vault = newVault(suite);
    await vault.lock();

    await expect(vault.unlock(PASSWORD)).rejects.toThrow("vault_keys_unreadable");

    const state = await vault.getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBeUndefined();
    expect(state.lockReason).not.toBe("background_restarted");
  });

  it("an unlock that opens no key over a live session leaves it locked, not blamed on the browser", async () => {
    const records = maps.local.get("encryptedKeys") as Array<Record<string, unknown>>;
    maps.local.set("encryptedKeys", [{ ...records[0], pubkey: "cd".repeat(32) }]);
    const vault = newVault(suite);

    await expect(vault.unlock(PASSWORD)).rejects.toThrow("vault_keys_unreadable");

    const state = await vault.getLockState();
    expect(state.isLocked).toBe(true);
    expect(state.lockReason).toBeUndefined();
  });

  it("drops an inactivity duration that is not a whole number inside the auto-lock range", async () => {
    const vault = newVault(suite);
    for (const bad of [1.5, Number.POSITIVE_INFINITY, Number.NaN, 0, -3, 61, "35", null]) {
      await vault.lock();
      maps.session.set("lockState", {
        ...(maps.session.get("lockState") as object),
        lockReason: "inactivity",
        inactivityMinutes: bad,
      });
      const state = await vault.getLockState();
      expect(state, String(bad)).toMatchObject({ isLocked: true, lockReason: "inactivity" });
      expect(state.inactivityMinutes, String(bad)).toBeUndefined();
    }

    maps.session.set("lockState", {
      ...(maps.session.get("lockState") as object),
      lockReason: "inactivity",
      inactivityMinutes: 35,
    });
    expect((await vault.getLockState()).inactivityMinutes).toBe(35);
  });
});

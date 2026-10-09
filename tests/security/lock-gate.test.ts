import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";

/**
 * The lock gate on the RPC surface.
 *
 * The defect: the options page had no lock check at all, and nothing between a
 * message and a handler consulted the lock state. With the vault locked, the
 * options page still rendered every key label and public key, every origin
 * policy, the relay list and the activity log - and it still permitted
 * mutation, so brief physical access could raise an origin to `high` trust that
 * then signed silently the next time the user unlocked.
 *
 * The gate is an ALLOWLIST, which is the property these tests are really
 * defending: a method added to the RPC union tomorrow is refused while locked
 * until someone deliberately classifies it.
 */

const RUNTIME_ID = "ostrilo-test-runtime-id";
const ORIGIN = `chrome-extension://${RUNTIME_ID}/`;

/** Every method name in the RpcRequest union, read from the source of truth. */
function unionMethods(): string[] {
  const src = readFileSync(
    resolve(__dirname, "../../src/infrastructure/messaging/rpc.ts"),
    "utf-8"
  );
  const found = [...src.matchAll(/type:\s*"([a-z]+\.[A-Za-z]+)"/g)].map(
    (m) => m[1]
  );
  const unique = [...new Set(found)];
  // A guard on the guard: if the regex stops matching the file's shape, the
  // enumeration test would silently pass over an empty list.
  expect(
    unique.length,
    "failed to enumerate the RpcRequest union - has rpc.ts changed shape?"
  ).toBeGreaterThan(25);
  return unique;
}

describe("every RPC method has a lock disposition", () => {
  it("classifies every method in the union, defaulting to refused", async () => {
    const { isLockedReachable } = await import(
      "@/infrastructure/messaging/rpc-router"
    );

    // Reachable while locked. Each entry is a deliberate decision, and the
    // reason it is safe is stated here rather than inferred from the name.
    const expectedReachable = new Set([
      "vault.unlock", // the way out of being locked
      "vault.lock", // locking a locked vault is a no-op, never a disclosure
      "vault.generate", // first key: there is no vault to unlock yet
      "vault.import", // same
      "vault.reveal", // re-verifies the password itself, a stronger check
      "state.getLock", // the lock screen asks whether it should be showing
      "state.touch", // records activity; refuses to revive a locked vault
      "keys.list", // redacted while locked - see the projection tests below
      "settings.get", // redacted while locked - see the projection tests below
      "crypto.evaluatePassword", // operates on a typed password, reads nothing
      "crypto.parsePrivateKey", // operates on pasted input, reads nothing
    ]);

    const actualReachable = new Set(
      unionMethods().filter((m) => isLockedReachable(m))
    );

    expect(
      [...actualReachable].sort(),
      "a method changed its lock disposition without this list being updated"
    ).toEqual([...expectedReachable].sort());
  });

  it("refuses an unrecognized method while locked", async () => {
    const { isLockedReachable } = await import(
      "@/infrastructure/messaging/rpc-router"
    );
    expect(isLockedReachable("some.methodAddedTomorrow")).toBe(false);
    expect(isLockedReachable("")).toBe(false);
  });
});

describe("locked behaviour at the message boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("wxt/browser", () => ({
      browser: {
        runtime: {
          id: RUNTIME_ID,
          getURL: (p: string) => `${ORIGIN}${p.replace(/^\//, "")}`,
        },
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock("wxt/browser");
    vi.resetModules();
  });

  async function send(
    message: unknown,
    opts: {
      isLocked: boolean;
      data?: unknown;
      namespace: string;
      onCall?: (m: unknown) => void;
    }
  ) {
    const mod = await import("@/infrastructure/messaging/rpc-router");
    const router = new mod.RpcRouter();
    router.registerModule(opts.namespace, {
      handleRequest: async (m: unknown) => {
        opts.onCall?.(m);
        return { ok: true as const, data: opts.data ?? null };
      },
    });
    const listener = mod.createRpcMessageListener(router, {
      vault: { getLockState: async () => ({ isLocked: opts.isLocked }) },
    } as never);

    return await new Promise<any>((res) => {
      (listener as (m: unknown, s: unknown, r: (x: unknown) => void) => unknown)(
        message,
        { id: RUNTIME_ID, url: `${ORIGIN}options.html` },
        res
      );
    });
  }

  it("refuses settings.update while locked and never reaches the handler", async () => {
    let reached = false;
    const res = await send(
      { type: "settings.update", patch: { autoLockMinutes: 60 } },
      {
        isLocked: true,
        namespace: "settings",
        onCall: () => {
          reached = true;
        },
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    expect(
      reached,
      "SECURITY REGRESSION: a locked vault permitted a settings write"
    ).toBe(false);
  });

  it("refuses every policy mutation while locked", async () => {
    for (const type of [
      "policy.setOrigin",
      "policy.setKindRule",
      "policy.setSession",
      "policy.clearSession",
      "policy.removeOrigin",
      "policy.evaluate",
    ]) {
      let reached = false;
      const res = await send(
        { type, origin: "https://evil.example" },
        {
          isLocked: true,
          namespace: "policy",
          onCall: () => {
            reached = true;
          },
        }
      );
      expect(res.ok, `${type} must be refused while locked`).toBe(false);
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
      expect(reached, `${type} reached its handler while locked`).toBe(false);
    }
  });

  it("refuses a password change while locked, without reaching the handler", async () => {
    let reached = false;
    const res = await send(
      {
        type: "vault.changePassword",
        currentPassword: "Old-Harbour-Lantern-58",
        newPassword: "New-Quartz-Meadow-2026",
      },
      {
        isLocked: true,
        namespace: "vault",
        onCall: () => {
          reached = true;
        },
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.LOCKED);
    expect(reached).toBe(false);
  });

  it("redacts keys.list while locked to bare identifiers", async () => {
    const records = [
      { id: "a", label: "Trading key", publicKey: "ab".repeat(32), isSelected: true },
      { id: "b", label: "Personal", publicKey: "cd".repeat(32), isSelected: false },
    ];
    const res = await send({ type: "keys.list" }, {
      isLocked: true,
      namespace: "keys",
      data: records,
    });

    expect(res.ok).toBe(true);
    // Length is preserved: the lock screen has to tell "no keys yet, show
    // onboarding" from "keys exist, ask for the password".
    expect(res.data).toHaveLength(2);
    const dump = JSON.stringify(res.data);
    for (const secret of ["Trading key", "Personal", "ab".repeat(32), "cd".repeat(32)]) {
      expect(
        dump,
        `SECURITY REGRESSION: a locked keys.list disclosed ${secret.slice(0, 12)}`
      ).not.toContain(secret);
    }
    expect(res.data).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("passes the lock reason through state.getLock, and nothing else, while locked", async () => {
    const res = await send({ type: "state.getLock" }, {
      isLocked: true,
      namespace: "state",
      data: {
        isLocked: true,
        lockReason: "inactivity",
        inactivityMinutes: 35,
        lockAt: 1_800_000_000_000,
        privateKeyHex: "ee".repeat(32),
      },
    });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({
      isLocked: true,
      selectedKeyId: undefined,
      lockReason: "inactivity",
      inactivityMinutes: 35,
    });
    expect(JSON.stringify(res.data)).not.toContain("ee".repeat(32));
  });

  it("returns keys.list unredacted once unlocked", async () => {
    const records = [{ id: "a", label: "Trading key", publicKey: "ab".repeat(32) }];
    const res = await send({ type: "keys.list" }, {
      isLocked: false,
      namespace: "keys",
      data: records,
    });
    expect(res.data).toEqual(records);
  });

  it("redacts settings.get while locked, keeping the lock screen working", async () => {
    const settings = {
      __version: "settings.v1",
      theme: "dark",
      sidePanel: true,
      onboardingCompleted: true,
      autoLockMinutes: 5,
      sessionTTLMinutes: 15,
      relays: ["wss://relay.private.example"],
      origins: [{ origin: "https://myexchange.example", trustLevel: "high" }],
      mediumAllowKinds: [1],
      selectedKeyId: "key-1",
    };
    const res = await send({ type: "settings.get" }, {
      isLocked: true,
      namespace: "settings",
      data: settings,
    });

    expect(res.ok).toBe(true);
    // Kept: the lock screen renders with the user's theme and knows whether
    // onboarding has been done.
    expect(res.data.theme).toBe("dark");
    expect(res.data.sidePanel).toBe(true);
    expect(res.data.onboardingCompleted).toBe(true);

    // Dropped: these describe what the user does and who they are.
    const dump = JSON.stringify(res.data);
    expect(dump).not.toContain("relay.private.example");
    expect(dump).not.toContain("myexchange.example");
    expect(dump).not.toContain("key-1");
    expect(res.data.relays).toEqual([]);
    expect(res.data.origins).toEqual([]);
    expect(res.data.selectedKeyId).toBeUndefined();
  });

  it("returns settings.get unredacted once unlocked", async () => {
    const settings = {
      __version: "settings.v1",
      theme: "dark",
      relays: ["wss://relay.private.example"],
      selectedKeyId: "key-1",
    };
    const res = await send({ type: "settings.get" }, {
      isLocked: false,
      namespace: "settings",
      data: settings,
    });
    expect(res.data).toEqual(settings);
  });
});

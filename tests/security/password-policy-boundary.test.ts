import { describe, it, expect, beforeEach } from "vitest";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import type { StorageSuite } from "@/application/ports/storage";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import { UnlockThrottleService } from "@/application/services/unlock-throttle.service";

/**
 * The password policy, enforced at the TRUST BOUNDARY rather than in the UI.
 *
 * The defect: four key-creation surfaces, two checking `strength.score < 3`
 * (satisfiable by character variety alone, so `Aa1!` passed) and two checking
 * only `if (!password)`. The RPC schema was `z.string().min(1).max(1000)`. So
 * the only real policy in the product lived inside two React components, and it
 * was wrong in both.
 *
 * These tests go through the RPC handler, not the UI, because that is the point:
 * a caller that bypasses the component must still be refused.
 */

function memoryStorage(): StorageSuite {
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
    local: make(maps.local),
    sync: make(maps.sync),
    session: make(maps.session),
  } as StorageSuite;
}

// Cheap recorded KDF so the suite is not dominated by Argon2id.
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

describe("password policy at the RPC boundary", () => {
  let handler: VaultRpcHandler;
  let context: ServiceContext;

  beforeEach(() => {
    const storage = memoryStorage();
    const vault = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    handler = new VaultRpcHandler();
    context = {
      vault,
      unlockThrottle: new UnlockThrottleService(storage.local),
    } as unknown as ServiceContext;
  });

  const generate = (password: string, label?: string) =>
    handler.handleRequest(
      { type: "vault.generate", password, label } as never,
      context
    );

  it("refuses Aa1!, which every old UI gate accepted", async () => {
    const res = await generate("Aa1!", "k1");
    expect(
      res.ok,
      "SECURITY REGRESSION: a 4-character password created a vault key"
    ).toBe(false);
    if (!res.ok) {
      expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
    }
  });

  it("refuses a single character, which the dialog paths accepted", async () => {
    const res = await generate("a", "k1");
    expect(res.ok).toBe(false);
  });

  it("refuses an 8-character password, the old nominal minimum", async () => {
    const res = await generate("Tr0ub4dr", "k1");
    expect(res.ok).toBe(false);
  });

  it("refuses a common password even when it is long enough", async () => {
    const res = await generate("Password123!", "k1");
    expect(res.ok).toBe(false);
  });

  it("refuses a password containing the key label", async () => {
    const res = await generate("mytradingkeyvalue", "MyTradingKey");
    expect(res.ok).toBe(false);
  });

  it("accepts a passphrase", async () => {
    const res = await generate("unmark thicket parcel", "k1");
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it("never echoes the password in the error it returns", async () => {
    const secret = "Aa1!";
    const res = await generate(secret, "k1");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(secret);
  });

  it("applies the policy to import as well as generate", async () => {
    const res = await handler.handleRequest(
      {
        type: "vault.import",
        keyInput: "11".repeat(32),
        password: "Aa1!",
        label: "k1",
      } as never,
      context
    );
    expect(res.ok).toBe(false);
  });

  it("does NOT apply the new-password policy once the vault has a key", async () => {
    // Adding a second key re-enters the EXISTING vault password. Running a
    // new-password policy here would tell a pre-existing user that their own
    // correct password is invalid, with no change-password flow to escape
    // through. So the policy is for creation only.
    const first = await generate("unmark thicket parcel", "k1");
    expect(first.ok).toBe(true);

    const second = await handler.handleRequest(
      {
        type: "vault.import",
        keyInput: "22".repeat(32),
        password: "unmark thicket parcel",
        label: "k2",
      } as never,
      context
    );
    expect(
      second.ok,
      "an existing vault password must keep working for additional keys"
    ).toBe(true);
  });

  it("keeps unlock on hygiene-only validation", async () => {
    // A user whose password predates the policy must still be able to unlock.
    await generate("unmark thicket parcel", "k1");
    const res = await handler.handleRequest(
      { type: "vault.unlock", password: "unmark thicket parcel" } as never,
      context
    );
    expect(res.ok).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { VaultRpcHandler } from "@/infrastructure/messaging/handlers/vault-rpc";
import { PolicyRpcHandler } from "@/infrastructure/messaging/handlers/policy-rpc";
import { SettingsRpcHandler } from "@/infrastructure/messaging/handlers/settings-rpc";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { PolicyService } from "@/application/services/policy.service";
import { SettingsService } from "@/application/services/settings.service";
import { UnlockThrottleService } from "@/application/services/unlock-throttle.service";
import {
  WebCryptoAesGcm,
  VaultKdf,
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
import { RPC_ERROR_CODES } from "@/infrastructure/messaging/error-codes";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";
import type { StorageSuite } from "@/application/ports/storage";
import type { ServiceContext } from "@/infrastructure/messaging/rpc-router";
import {
  ORIGIN_PATCH_AUTHORITY_FIELDS,
  ORIGIN_PATCH_INERT_FIELDS,
  patchGrantsAuthority,
} from "@/infrastructure/messaging/reauth";
import { OriginPolicyPatchSchema } from "@/infrastructure/validation/schemas";

/**
 * Re-authentication for high-risk actions, enforced at the message boundary.
 *
 * The defect: an unlocked vault was a single, undifferentiated level of
 * authority. The most damaging actions it permitted are the quiet ones -
 * raising an origin to `high` trust takes two clicks, produces no prompt
 * afterwards, and signs silently from then on. Deleting a key is irreversible.
 * Lengthening the auto-lock timeout buys the next person at the keyboard time.
 * None of them asked for anything beyond an unlocked session.
 *
 * These tests drive the HANDLERS, not the dialog, because that is the point: a
 * caller who skips the dialog and sends the message must still be refused.
 */

const PASSWORD = "unmark thicket parcel";
const WRONG = "wrong parcel thicket unmark";

function memoryStorage(): StorageSuite {
  const make = () => {
    const m = new Map<string, unknown>();
    return {
      async get<T>(k: string): Promise<T | undefined> {
        return m.get(k) as T | undefined;
      },
      async set<T>(k: string, v: T): Promise<void> {
        m.set(k, v);
      },
      async remove(k: string): Promise<void> {
        m.delete(k);
      },
    };
  };
  return { local: make(), sync: make(), session: make() } as StorageSuite;
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

describe("high-risk actions require a verified password", () => {
  let context: ServiceContext;
  let vault: KeyVaultService;
  let settings: SettingsService;
  let policy: PolicyService;
  let vaultRpc: VaultRpcHandler;
  let policyRpc: PolicyRpcHandler;
  let settingsRpc: SettingsRpcHandler;
  let keyIds: string[];

  beforeEach(async () => {
    const storage = memoryStorage();
    vault = new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      fastKdf as never,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    settings = new SettingsService(storage);
    policy = new PolicyService(storage);
    vaultRpc = new VaultRpcHandler();
    policyRpc = new PolicyRpcHandler();
    settingsRpc = new SettingsRpcHandler();
    context = {
      vault,
      settings,
      policy,
      unlockThrottle: new UnlockThrottleService(storage.local),
    } as unknown as ServiceContext;

    // Two keys, so deleting one is not refused as "the last key" and the test
    // is actually exercising the password gate.
    const a = await vault.generateKey(PASSWORD, "k1");
    const b = await vault.generateKey(PASSWORD, "k2");
    keyIds = [a.id, b.id];
    await vault.unlock(PASSWORD);
  });

  describe("key deletion", () => {
    const del = (handler: VaultRpcHandler, id: string, password?: string) =>
      handler.handleRequest(
        { type: "vault.deleteKey", id, password } as never,
        context
      );

    it("refuses without a password and leaves the key in place", async () => {
      const res = await del(vaultRpc, keyIds[0]);

      expect(
        res.ok,
        "SECURITY REGRESSION: an unlocked vault deleted a key with no password"
      ).toBe(false);
      expect((await vault.listKeys()).map((k) => k.id)).toContain(keyIds[0]);
    });

    it("refuses an incorrect password and leaves the key in place", async () => {
      const res = await del(vaultRpc, keyIds[0], WRONG);

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
      }
      expect((await vault.listKeys()).map((k) => k.id)).toContain(keyIds[0]);
    });

    it("proceeds with the correct password", async () => {
      const res = await del(vaultRpc, keyIds[0], PASSWORD);

      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect((await vault.listKeys()).map((k) => k.id)).not.toContain(keyIds[0]);
    });

    it("never echoes the password in its response", async () => {
      const res = await del(vaultRpc, keyIds[0], WRONG);
      expect(JSON.stringify(res)).not.toContain(WRONG);
    });

    it("does not remember the password for the next action", async () => {
      // One verification authorizes one action. A "verified for the next few
      // minutes" window is the same unbounded-authority problem in a smaller box.
      expect((await del(vaultRpc, keyIds[0], PASSWORD)).ok).toBe(true);
      const second = await del(vaultRpc, keyIds[1]);
      expect(
        second.ok,
        "SECURITY REGRESSION: a second deletion rode on the first verification"
      ).toBe(false);
    });
  });

  describe("rename is deliberately not gated", () => {
    it("renames without a password", async () => {
      const res = await vaultRpc.handleRequest(
        { type: "vault.renameKey", id: keyIds[0], label: "Renamed" } as never,
        context
      );
      expect(
        res.ok,
        "a rename is reversible and discloses nothing; gating it would train the user to type their password at every prompt"
      ).toBe(true);
    });
  });

  describe("raising trust", () => {
    const setOrigin = (
      trustLevel: string,
      password?: string,
      origin = "https://exchange.example"
    ) =>
      policyRpc.handleRequest(
        {
          type: "policy.setOrigin",
          origin,
          patch: { trustLevel },
          password,
        } as never,
        context
      );

    it("refuses high trust without a password and stores nothing", async () => {
      const res = await setOrigin("high");

      expect(
        res.ok,
        "SECURITY REGRESSION: an origin was raised to high trust with no password"
      ).toBe(false);
      const stored = await settings.get();
      expect(
        stored?.origins?.find((o) => o.origin === "https://exchange.example")
      ).toBeUndefined();
    });

    it("refuses an incorrect password and stores nothing", async () => {
      const res = await setOrigin("high", WRONG);
      expect(res.ok).toBe(false);
      const stored = await settings.get();
      expect(
        stored?.origins?.find((o) => o.origin === "https://exchange.example")
      ).toBeUndefined();
    });

    it("proceeds with the correct password", async () => {
      const res = await setOrigin("high", PASSWORD);
      expect(res.ok, JSON.stringify(res)).toBe(true);
      const stored = await settings.get();
      expect(
        stored?.origins?.find((o) => o.origin === "https://exchange.example")
          ?.trustLevel
      ).toBe("high");
    });

    it("does not gate lowering trust", async () => {
      // Only raising authority costs a password. Reducing it must stay
      // frictionless, or a user who wants to revoke access has to find their
      // password first.
      for (const level of ["low", "medium"]) {
        const res = await setOrigin(level, undefined, `https://${level}.example`);
        expect(res.ok, `${level} trust must not require a password`).toBe(true);
      }
    });
  });

  describe("the origin patch has one path per authority", () => {
    const ORIGIN = "https://exchange.example";
    const patchOrigin = (patch: Record<string, unknown>, password?: string) =>
      policyRpc.handleRequest(
        { type: "policy.setOrigin", origin: ORIGIN, patch, password } as never,
        context
      );
    const stored = async () =>
      (await settings.get())?.origins?.find((o) => o.origin === ORIGIN);

    it("refuses per-kind rules, even with the password, and stores nothing", async () => {
      for (const password of [undefined, PASSWORD]) {
        const res = await patchOrigin({ rules: { "0": "allow", "3": "allow" } }, password);
        expect(
          res.ok,
          "SECURITY REGRESSION: setOrigin wrote per-kind rules around setKindRule's password gate"
        ).toBe(false);
        if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
      }
      expect(await stored()).toBeUndefined();
    });

    it("refuses the session display flag and creates no grant", async () => {
      const res = await patchOrigin({ sessionGrantAll: true });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PARAMS);
      expect(await stored()).toBeUndefined();
      expect(await policy.getSessionGrants()).not.toHaveProperty(ORIGIN);
    });

    it("refuses disclosure consent without the password", async () => {
      for (const password of [undefined, WRONG]) {
        const res = await patchOrigin({ identityDisclosure: "allow" }, password);
        expect(
          res.ok,
          "SECURITY REGRESSION: disclosure consent was granted with no password"
        ).toBe(false);
        if (!res.ok && password === undefined) {
          expect(res.error.data.errorCode).toBe(RPC_ERROR_CODES.INVALID_PASSWORD);
        }
      }
      expect(await policy.getIdentityDisclosure(ORIGIN, keyIds[0])).toBeUndefined();
    });

    it("grants disclosure consent under the password", async () => {
      const res = await patchOrigin({ identityDisclosure: "allow" }, PASSWORD);
      expect(res.ok, JSON.stringify(res)).toBe(true);
      // The patch names no key, so it grants the selected one and no other.
      expect(await policy.getIdentityDisclosure(ORIGIN, keyIds[0])).toBe("allow");
      expect(await policy.getIdentityDisclosure(ORIGIN, keyIds[1])).toBeUndefined();
    });

    it("does not gate tightening disclosure consent", async () => {
      await patchOrigin({ identityDisclosure: "allow" }, PASSWORD);
      for (const decision of ["ask", "deny"] as const) {
        const res = await patchOrigin({ identityDisclosure: decision });
        expect(res.ok, `${decision} must not require a password`).toBe(true);
        // `ask` is the prompting state, which reads back as no decision.
        expect(await policy.getIdentityDisclosure(ORIGIN, keyIds[0])).toBe(
          decision === "deny" ? "deny" : undefined
        );
      }
    });

    it("classifies every patch field as authority-granting or inert", () => {
      const classified = new Set<string>([
        ...ORIGIN_PATCH_AUTHORITY_FIELDS,
        ...ORIGIN_PATCH_INERT_FIELDS,
      ]);
      for (const field of Object.keys(OriginPolicyPatchSchema.shape)) {
        expect(
          classified.has(field),
          `SECURITY REGRESSION: "${field}" was added to the origin patch without deciding whether it needs the password`
        ).toBe(true);
      }
      // And the authority-granting fields are exactly the ones that gate.
      expect(patchGrantsAuthority({ trustLevel: "high" })).toBe(true);
      expect(patchGrantsAuthority({ identityDisclosure: "allow" })).toBe(true);
      expect(patchGrantsAuthority({ trustLevel: "medium", identityDisclosure: "deny" })).toBe(false);
    });
  });

  describe("standing signing permissions", () => {
    it("gates a per-kind allow rule but not deny or ask", async () => {
      const rule = (mode: string, password?: string) =>
        policyRpc.handleRequest(
          {
            type: "policy.setKindRule",
            origin: "https://exchange.example",
            kind: 1,
            mode,
            password,
          } as never,
          context
        );

      expect((await rule("allow")).ok).toBe(false);
      expect((await rule("allow", WRONG)).ok).toBe(false);
      expect((await rule("allow", PASSWORD)).ok).toBe(true);
      expect((await rule("deny")).ok).toBe(true);
      expect((await rule("ask")).ok).toBe(true);
    });

    it("gates enabling a session grant but not disabling one", async () => {
      const session = (enabled: boolean, password?: string) =>
        policyRpc.handleRequest(
          {
            type: "policy.setSession",
            origin: "https://exchange.example",
            enabled,
            password,
          } as never,
          context
        );

      expect(
        (await session(true)).ok,
        "SECURITY REGRESSION: a session grant was created with no password"
      ).toBe(false);
      expect((await session(true, WRONG)).ok).toBe(false);
      expect((await session(true, PASSWORD)).ok).toBe(true);
      expect(
        (await session(false)).ok,
        "revoking a grant must never require a password"
      ).toBe(true);
    });
  });

  describe("security timeouts", () => {
    const update = (patch: Record<string, unknown>, password?: string) =>
      settingsRpc.handleRequest(
        { type: "settings.update", patch, password } as never,
        context
      );

    it("refuses an auto-lock change without a password and stores nothing", async () => {
      const before = (await settings.get())?.autoLockMinutes;
      const res = await update({ autoLockMinutes: AUTO_LOCK_BOUNDS.max });

      expect(
        res.ok,
        "SECURITY REGRESSION: the auto-lock timeout changed with no password"
      ).toBe(false);
      expect((await settings.get())?.autoLockMinutes).toBe(before);
    });

    it("refuses a session TTL change without a password", async () => {
      const res = await update({ sessionTTLMinutes: 60 });
      expect(res.ok).toBe(false);
    });

    it("proceeds with the correct password", async () => {
      const res = await update({ autoLockMinutes: 30 }, PASSWORD);
      expect(res.ok, JSON.stringify(res)).toBe(true);
      expect((await settings.get())?.autoLockMinutes).toBe(30);
    });

    it("does not gate an unrelated settings write", async () => {
      const res = await update({ theme: "dark" });
      expect(
        res.ok,
        "changing the theme must not require the master password"
      ).toBe(true);
    });

    it("gates a patch that hides a timeout among harmless fields", async () => {
      const res = await update({ theme: "dark", autoLockMinutes: 60 });
      expect(
        res.ok,
        "SECURITY REGRESSION: a timeout change slipped through inside a larger patch"
      ).toBe(false);
      expect((await settings.get())?.theme).not.toBe("dark");
    });
  });
});

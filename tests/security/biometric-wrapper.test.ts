import { describe, expect, it } from "vitest";
import type { SecretBytes } from "@/application/ports/crypto";
import type { StorageSuite } from "@/application/ports/storage";
import {
  BiometricPasswordNeededError,
  BiometricRejectedError,
  VAULT_BIOMETRIC_STORAGE,
} from "@/application/services/biometric-factor.service";
import {
  PASSWORD_REHEARSAL_DAYS,
  type BiometricFactor,
  type KeyRecord,
  type VaultBiometricRecord,
  type VaultEnvelope,
} from "@/domain/types";
import { memoryStorage, testBiometricVault, testVault } from "../helpers/vault";

/**
 * The biometric wrapping is a second way to recover the vault KEK. This suite
 * is its acceptance gate: the only thing that may open the vault is the
 * enrolled authenticator's output against the envelope it was enrolled for,
 * and nothing a storage writer can rewrite may change that.
 *
 * There is no authenticator here. The PRF output is 32 bytes the test holds,
 * which is all the background ever sees of a ceremony.
 */

const PASSWORD = "Harbour-Lantern-Quartz-58";
const NEXT_PASSWORD = "Meadow-Granite-Willow-2026";
const SECRET = "0000000000000000000000000000000000000000000000000000000000000001";

const FACTOR: BiometricFactor = {
  credentialId: Array.from({ length: 16 }, (_, i) => i + 1),
  prfSalt: Array.from({ length: 32 }, (_, i) => 255 - i),
  transports: ["internal", "hybrid"],
  backupEligible: true,
};
const OTHER_FACTOR: BiometricFactor = {
  ...FACTOR,
  credentialId: Array.from({ length: 16 }, (_, i) => i + 101),
};

/** A fresh buffer each call: the vault takes ownership and zeroizes it. */
const prf = (fill = 0x5a) => new Uint8Array(32).fill(fill) as SecretBytes;
const credentialId = (factor = FACTOR) => Uint8Array.from(factor.credentialId);

async function enrolled(now?: () => number) {
  const storage = memoryStorage();
  const fixture = testBiometricVault(storage, { now });
  await fixture.vault.importKey(SECRET, PASSWORD);
  await fixture.vault.unlock(PASSWORD);
  await fixture.vault.enrollBiometric(PASSWORD, FACTOR, prf());
  await fixture.vault.lock();
  return fixture;
}

const storedFactor = (storage: StorageSuite) =>
  storage.local.get<VaultBiometricRecord>(VAULT_BIOMETRIC_STORAGE);

async function rewriteFactor(
  storage: StorageSuite,
  change: (record: VaultBiometricRecord) => VaultBiometricRecord
) {
  const record = await storedFactor(storage);
  await storage.local.set(VAULT_BIOMETRIC_STORAGE, change(structuredClone(record!)));
}

async function expectStillLocked(vault: { getLockState(): Promise<{ isLocked: boolean }> }) {
  expect((await vault.getLockState()).isLocked).toBe(true);
}

describe("biometric wrapping of the vault key", () => {
  it("opens the vault with the enrolled output and records how it was opened", async () => {
    const { vault } = await enrolled();

    const result = await vault.unlockWithFactor(credentialId(), prf());

    expect(result.unlockedKeyIds).toHaveLength(1);
    expect(result.damagedKeyIds).toEqual([]);
    expect(await vault.getLockState()).toMatchObject({
      isLocked: false,
      authFactor: "biometric",
    });
  });

  it("records a password session as a password session", async () => {
    const { vault } = await enrolled();
    await vault.unlock(PASSWORD);
    expect((await vault.getLockState()).authFactor).toBe("password");
  });

  describe("what does not open it", () => {
    it("a different output", async () => {
      const { vault } = await enrolled();
      await expect(vault.unlockWithFactor(credentialId(), prf(0x5b))).rejects.toThrow(
        BiometricRejectedError
      );
      await expectStillLocked(vault);
    });

    it("an output of the wrong length", async () => {
      const { vault } = await enrolled();
      await expect(
        vault.unlockWithFactor(credentialId(), new Uint8Array(31).fill(0x5a) as SecretBytes)
      ).rejects.toThrow(BiometricRejectedError);
    });

    it("the right output presented for a different credential", async () => {
      const { vault } = await enrolled();
      await expect(
        vault.unlockWithFactor(credentialId(OTHER_FACTOR), prf())
      ).rejects.toThrow(BiometricRejectedError);
      await expectStillLocked(vault);
    });

    it.each([
      [
        "a rewritten credential id",
        (r: VaultBiometricRecord) => ({ ...r, credentialId: OTHER_FACTOR.credentialId }),
        OTHER_FACTOR,
      ],
      [
        "a rewritten PRF salt",
        (r: VaultBiometricRecord) => ({ ...r, prfSalt: r.prfSalt.map((b) => b ^ 1) }),
        FACTOR,
      ],
      [
        "a flipped backup-eligible flag",
        (r: VaultBiometricRecord) => ({ ...r, backupEligible: !r.backupEligible }),
        FACTOR,
      ],
    ])("%s in the stored record", async (_name, change, presented) => {
      const { vault, storage } = await enrolled();
      await rewriteFactor(storage, change);
      await expect(
        vault.unlockWithFactor(credentialId(presented), prf())
      ).rejects.toThrow(BiometricRejectedError);
      await expectStillLocked(vault);
    });

    it("a changed KDF cost in the envelope", async () => {
      const { vault, storage } = await enrolled();
      const envelope = await storage.local.get<VaultEnvelope>("vaultEnvelope");
      await storage.local.set("vaultEnvelope", {
        ...envelope!,
        kdf: { ...envelope!.kdf, t: 3 },
      });
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
    });

    it("another vault's envelope swapped in", async () => {
      const { vault, storage } = await enrolled();
      const other = testVault();
      await other.vault.importKey(SECRET, PASSWORD);
      await storage.local.set(
        "vaultEnvelope",
        await other.storage.local.get<VaultEnvelope>("vaultEnvelope")
      );
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
    });

    it("a wrapping rewritten to hold a different key fails the envelope verifier", async () => {
      const { vault, biometric, storage } = await enrolled();
      const envelope = await storage.local.get<VaultEnvelope>("vaultEnvelope");
      // A storage writer who knows an output can wrap any 32 bytes validly.
      // The wrapping opens; what it yields is not this vault's key.
      const foreignKek = new Uint8Array(32).fill(0x77) as SecretBytes;
      await biometric.enroll(foreignKek, envelope!, FACTOR, prf(0x11));

      await expect(vault.unlockWithFactor(credentialId(), prf(0x11))).rejects.toThrow(
        BiometricRejectedError
      );
      await expectStillLocked(vault);
    });

    it("a record this build did not write", async () => {
      const { vault, storage } = await enrolled();
      await rewriteFactor(storage, (r) => ({ ...r, v: 2 }));
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
      expect(await vault.biometricStatus()).toEqual({ enrolled: false });
    });
  });

  describe("the password is untouched by it", () => {
    it("still opens the vault after enrolment and after forgetting", async () => {
      const { vault } = await enrolled();
      await vault.unlock(PASSWORD);
      await vault.lock();

      await vault.forgetBiometric();
      await vault.unlock(PASSWORD);
      expect((await vault.getLockState()).isLocked).toBe(false);
    });

    it("enrolment refuses a wrong password and leaves an existing factor usable", async () => {
      const { vault, storage } = await enrolled();
      const before = await storedFactor(storage);

      await expect(
        vault.enrollBiometric("not-the-password", OTHER_FACTOR, prf(0x22))
      ).rejects.toThrow("incorrect_password");

      expect(await storedFactor(storage)).toEqual(before);
      await vault.unlockWithFactor(credentialId(), prf());
      expect((await vault.getLockState()).isLocked).toBe(false);
    });

    it("forgetting removes the wrapping and needs nothing", async () => {
      const { vault, storage } = await enrolled();
      await vault.forgetBiometric();
      expect(await storedFactor(storage)).toBeUndefined();
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
    });
  });

  describe("at most one factor", () => {
    it("a second enrolment replaces the first, which no longer unlocks", async () => {
      const { vault, storage } = await enrolled();
      await vault.unlock(PASSWORD);
      await vault.enrollBiometric(PASSWORD, OTHER_FACTOR, prf(0x33));
      await vault.lock();

      expect((await storedFactor(storage))!.credentialId).toEqual(OTHER_FACTOR.credentialId);
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
      await vault.unlockWithFactor(credentialId(OTHER_FACTOR), prf(0x33));
      expect((await vault.getLockState()).isLocked).toBe(false);
    });
  });

  describe("a vault that needs the password once", () => {
    const legacyRecord = {
      id: "legacy",
      pubkey: "ab".repeat(32),
      ct: [1],
      iv: [1],
      salt: [1],
      createdAt: 1,
    } as KeyRecord;

    async function withLegacyRecord(storage: StorageSuite) {
      const records = (await storage.local.get<KeyRecord[]>("encryptedKeys")) ?? [];
      await storage.local.set("encryptedKeys", [...records, legacyRecord]);
    }

    it("refuses to unlock beside an unversioned record", async () => {
      const { vault, storage } = await enrolled();
      await withLegacyRecord(storage);
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toMatchObject({
        name: "BiometricPasswordNeededError",
        reason: "legacy_records",
      });
    });

    it("refuses to enrol beside an unversioned record", async () => {
      const storage = memoryStorage();
      const { vault } = testBiometricVault(storage);
      await vault.importKey(SECRET, PASSWORD);
      await vault.unlock(PASSWORD);
      await withLegacyRecord(storage);

      await expect(vault.enrollBiometric(PASSWORD, FACTOR, prf())).rejects.toThrow(
        BiometricRejectedError
      );
      expect(await storedFactor(storage)).toBeUndefined();
    });

    it("refuses while a rotation journal is present, and leaves it byte-identical", async () => {
      const { vault, storage } = await enrolled();
      const envelope = await storage.local.get<VaultEnvelope>("vaultEnvelope");
      const state = { envelope: envelope!, records: [] };
      const journal = { from: state, to: state };
      await storage.local.set("vaultRotation", structuredClone(journal));

      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toMatchObject({
        reason: "rotation_pending",
      });
      expect(await storage.local.get("vaultRotation")).toEqual(journal);
      await expectStillLocked(vault);
    });

    it("is not held back by a journal value recovery would ignore", async () => {
      const { vault, storage } = await enrolled();
      await storage.local.set("vaultRotation", { not: "a journal" });

      await vault.unlockWithFactor(credentialId(), prf());
      expect((await vault.getLockState()).isLocked).toBe(false);
    });

    it("refuses the first unlock of a browser session", async () => {
      const { vault, storage } = await enrolled();
      await storage.session.remove("passwordUnlockedThisSession");

      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toMatchObject({
        reason: "restart_pending",
      });
      expect(await vault.biometricStatus()).toMatchObject({
        enrolled: true,
        passwordNeeded: "restart_pending",
      });

      await vault.unlock(PASSWORD);
      await vault.lock();
      await vault.unlockWithFactor(credentialId(), prf());
      expect((await vault.getLockState()).isLocked).toBe(false);
    });

    it("refuses once the password has gone unused for the rehearsal window", async () => {
      let clock = 1_800_000_000_000;
      const { vault } = await enrolled(() => clock);
      const day = 24 * 60 * 60 * 1000;

      clock += PASSWORD_REHEARSAL_DAYS * day;
      await vault.unlockWithFactor(credentialId(), prf());
      await vault.lock();

      clock += 1;
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toBeInstanceOf(
        BiometricPasswordNeededError
      );
      expect((await vault.biometricStatus()).passwordNeeded).toBe("rehearsal_due");

      await vault.unlock(PASSWORD);
      await vault.lock();
      await vault.unlockWithFactor(credentialId(), prf());
      expect((await vault.getLockState()).isLocked).toBe(false);
    });

    it("reads a rehearsal timestamp from the future as due", async () => {
      const { vault, storage } = await enrolled();
      await rewriteFactor(storage, (r) => ({
        ...r,
        lastPasswordUnlockAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }));
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toMatchObject({
        reason: "rehearsal_due",
      });
    });
  });

  describe("every envelope write deletes the wrapping", () => {
    it("a completed password change leaves no factor", async () => {
      const { vault, storage } = await enrolled();
      await vault.unlock(PASSWORD);
      await vault.changePassword(PASSWORD, NEXT_PASSWORD);

      expect(await storedFactor(storage)).toBeUndefined();
      await vault.lock();
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
    });

    it.each([
      ["rolled forward", NEXT_PASSWORD],
      ["rolled back", PASSWORD],
    ])("an interrupted password change, %s, leaves no factor", async (_name, password) => {
      const { vault, storage } = await enrolled();
      await vault.unlock(PASSWORD);

      const set = storage.local.set.bind(storage.local);
      let failed = false;
      storage.local.set = async (key, value) => {
        if (key === "encryptedKeys" && !failed) {
          failed = true;
          throw new Error("injected fault");
        }
        return set(key, value);
      };
      await expect(vault.changePassword(PASSWORD, NEXT_PASSWORD)).rejects.toThrow(
        "injected fault"
      );
      expect(await storage.local.get("vaultRotation")).toBeDefined();

      const restarted = testBiometricVault(storage);
      await restarted.vault.unlock(password);
      expect(await storage.local.get("vaultRotation")).toBeUndefined();
      expect(await storedFactor(storage)).toBeUndefined();
    });

    it("creating the envelope deletes a wrapping left by an earlier vault", async () => {
      const storage = memoryStorage();
      const { vault } = testBiometricVault(storage);
      await storage.local.set(VAULT_BIOMETRIC_STORAGE, { stale: true });

      await vault.importKey(SECRET, PASSWORD);
      expect(await storedFactor(storage)).toBeUndefined();
    });
  });

  describe("what a surface may learn", () => {
    it("says whether the credential syncs only once unlocked", async () => {
      const { vault } = await enrolled();
      const locked = await vault.biometricStatus();
      expect(locked.enrolled).toBe(true);
      expect(locked).not.toHaveProperty("synced");

      await vault.unlock(PASSWORD);
      expect(await vault.biometricStatus()).toMatchObject({ enrolled: true, synced: true });
    });

    it("never reports the credential id through the status", async () => {
      const { vault } = await enrolled();
      expect(JSON.stringify(await vault.biometricStatus())).not.toContain("credentialId");
    });

    it("hands the ceremony what it needs and nothing wrapped", async () => {
      const { vault } = await enrolled();
      expect(await vault.biometricUnlockRequest()).toEqual({
        credentialId: FACTOR.credentialId,
        prfSalt: FACTOR.prfSalt,
        transports: FACTOR.transports,
      });
    });
  });

  describe("a build without the feature", () => {
    it("reports nothing enrolled and refuses every biometric call", async () => {
      const { vault } = testVault();
      await vault.importKey(SECRET, PASSWORD);

      expect(await vault.biometricStatus()).toEqual({ enrolled: false });
      await expect(vault.biometricUnlockRequest()).rejects.toThrow(BiometricRejectedError);
      await expect(vault.unlockWithFactor(credentialId(), prf())).rejects.toThrow(
        BiometricRejectedError
      );
      await expect(vault.enrollBiometric(PASSWORD, FACTOR, prf())).rejects.toThrow(
        BiometricRejectedError
      );
      await vault.forgetBiometric();
    });
  });
});

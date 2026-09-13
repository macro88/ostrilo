import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  NobleSchnorr, NobleSha256, ScureBech32,
  VaultKdf,
  WebCryptoAesGcm,
} from "@/infrastructure/crypto/adapters";
import type { StorageSuite } from "@/application/ports/storage";

/**
 * Properties the create-key flow already got right, pinned so a refactor cannot
 * quietly remove them.
 *
 * `revealKey` is the ONLY path that releases key material to the UI, and it
 * re-derives the key-encryption key from the password the caller supplies
 * rather than trusting the unlocked session. That distinction is the whole
 * point: a malicious page that can reach the RPC surface while the vault
 * happens to be unlocked gets nothing without the password. `vault.export`,
 * which did trust the session, was deleted for exactly this reason.
 *
 * These assertions belong with the backup flow because the backup step is the
 * only caller. If someone "simplifies" reveal to use the session key, the
 * backup step keeps working and nothing else in the suite notices.
 */

const PASSWORD = "correct-horse-battery-staple-42";

function memoryStorage(): StorageSuite {
  const make = () => {
    const map = new Map<string, unknown>();
    return {
      async get<T>(key: string): Promise<T | undefined> {
        return map.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        map.set(key, value);
      },
      async remove(key: string): Promise<void> {
        map.delete(key);
      },
    };
  };
  return { local: make(), sync: make(), session: make() } as StorageSuite;
}

describe("revealing a private key re-verifies the password", () => {
  let svc: KeyVaultService;
  let keyId: string;

  beforeEach(async () => {
    svc = new KeyVaultService(
      memoryStorage(),
      WebCryptoAesGcm,
      VaultKdf,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    );
    const record = await svc.generateKey(PASSWORD, "Everyday identity");
    keyId = record.id;
    await svc.unlock(PASSWORD);
  });

  it("returns the nsec and hex forms for the correct password", async () => {
    const revealed = await svc.revealKey(PASSWORD, keyId);

    expect(revealed.nsec).toMatch(/^nsec1[02-9ac-hj-np-z]+$/);
    expect(revealed.hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an incorrect password even though the vault is unlocked", async () => {
    // The session is open. That must not be enough.
    expect((await svc.getLockState()).isLocked).toBe(false);

    await expect(svc.revealKey("not-the-password", keyId)).rejects.toThrow(
      /incorrect_password/
    );
  });

  it("refuses an empty password", async () => {
    await expect(svc.revealKey("", keyId)).rejects.toThrow(
      /password_required/
    );
  });

  it("derives a key from the supplied password on every reveal", async () => {
    const derive = vi.spyOn(VaultKdf, "deriveKey");

    await svc.revealKey(PASSWORD, keyId);

    // A reveal that short-circuited to a cached session key would not derive.
    expect(derive).toHaveBeenCalled();
    expect(derive.mock.calls.some(([password]) => password === PASSWORD)).toBe(
      true
    );
    derive.mockRestore();
  });

  it("discloses no key material in the failure message", async () => {
    const revealed = await svc.revealKey(PASSWORD, keyId);
    const error = await svc
      .revealKey("not-the-password", keyId)
      .catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(revealed.nsec);
    expect((error as Error).message).not.toContain(revealed.hex);
    expect((error as Error).message).not.toContain(PASSWORD);
  });

  it("has no password-free release path left on the service", () => {
    // `vault.export` trusted the unlocked session and is gone. Reveal is the
    // only way out, and it takes a password as its first argument.
    expect(
      (svc as unknown as Record<string, unknown>).exportKey
    ).toBeUndefined();
    expect(svc.revealKey.length).toBeGreaterThanOrEqual(1);
  });
});

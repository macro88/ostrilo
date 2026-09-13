/**
 * A KeyVaultService wired for unit tests: in-memory storage, the real AEAD,
 * Schnorr, hash and bech32 adapters, and a deliberately cheap KDF.
 *
 * Shared rather than copied into each file. Three suites needed the same
 * fixture once `KeyVaultService` took the hash and bech32 ports by injection,
 * and a per-file copy is how the constructor drifts out of sync with the
 * composition root.
 *
 * The KDF is the ONLY thing faked here, and only because the real Argon2id
 * parameters cost hundreds of milliseconds per call. Everything that decides
 * what bytes get signed or stored is the real adapter. `tests/security/` is
 * where the KDF itself is pinned.
 */
import type { CryptoKdf, SecretBytes } from "@/application/ports/crypto";
import type { StorageSuite } from "@/application/ports/storage";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  NobleSchnorr,
  NobleSha256,
  ScureBech32,
  WebCryptoAesGcm,
} from "@/infrastructure/crypto/adapters";

export function memoryStorage(): StorageSuite {
  const make = () => {
    const m = new Map<string, unknown>();
    return {
      async get<T>(key: string) {
        return m.get(key) as T | undefined;
      },
      async set<T>(key: string, value: T) {
        m.set(key, value as unknown);
      },
      async remove(key: string) {
        m.delete(key);
      },
      async clear() {
        m.clear();
      },
    };
  };
  return { local: make(), sync: make(), session: make() } as StorageSuite;
}

/** Not a KDF. A deterministic stand-in that costs nothing. */
export const fastKdf: CryptoKdf = {
  async deriveKey(password: string): Promise<SecretBytes> {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = password.charCodeAt(i % password.length) ^ i;
    }
    return out as SecretBytes;
  },
};

export const TEST_VAULT_PASSWORD = "test-fixture-vault-password";

export function testVault(storage: StorageSuite = memoryStorage()): {
  vault: KeyVaultService;
  storage: StorageSuite;
} {
  return {
    vault: new KeyVaultService(
      storage,
      WebCryptoAesGcm,
      fastKdf,
      NobleSchnorr,
      NobleSha256,
      ScureBech32
    ),
    storage,
  };
}

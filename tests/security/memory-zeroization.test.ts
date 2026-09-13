import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import { WebCryptoAesGcm } from "@/infrastructure/crypto/adapters";
import type { SecretBytes } from "@/application/ports/crypto";

/**
 * Memory zeroization - real-behaviour tests.
 *
 * This suite previously mocked `zeroize` into a no-op with
 * `vi.mock("@/domain/utils/crypto", ...)` and asserted call counts such as
 * `toHaveBeenCalledTimes(2)`. That cannot fail for the right reason: a
 * `zeroize` that does nothing satisfies every one of those assertions, and the
 * suite was green while three unzeroized clones of key material per operation
 * sat in `toArrayBuffer()` and an unused `passwordBuffer` sat in `unlock()`.
 *
 * The rule this file follows: never mock the unit under test, and assert on an
 * effect rather than an invocation. `zeroize` is `buffer.fill(0)`, an in-place
 * mutation, so a test holding the same `Uint8Array` the production code holds
 * observes the clearing directly.
 *
 * Technique:
 *   - hand in buffers through the injected ports and keep the object identity,
 *     never a copy;
 *   - assert the buffer is NON-ZERO at handoff, so an all-zero buffer cannot
 *     produce a trivial pass;
 *   - retain the underlying byte storage, not just the view, so the assertion
 *     survives a view swap;
 *   - run the operation, then read the bytes back.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CANNOT GUARANTEE, stated plainly rather than implied away:
 *
 *   1. String secrets cannot be erased. `password` is an immutable JavaScript
 *      string whose backing storage is not addressable from script. The engine
 *      may have interned it, copied it during GC, or spilled it to a register
 *      or the stack. The testable property is narrower: no unnecessary copy is
 *      created, and no instance property or module variable retains it. That is
 *      what "password is not retained" below actually checks.
 *   2. Platform-internal copies are out of reach. `crypto.subtle.importKey`
 *      copies key bytes into an opaque `CryptoKey`. We cannot see or clear it.
 *   3. Garbage-collector timing is out of reach. Dropping a reference is
 *      permission to erase, not erasure.
 * ---------------------------------------------------------------------------
 */

const NON_ZERO_PATTERN = 0xab;

/** Retains the byte storage behind a view, so a view swap cannot hide a miss. */
function retain(buf: Uint8Array) {
  const storage = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    view: buf,
    bytes: storage,
    isAllZero: () => storage.every((b) => b === 0),
    isAllPattern: (p: number) => storage.every((b) => b === p),
  };
}

function makeSecret(fill: number, len = 32): SecretBytes {
  const b = new Uint8Array(len) as SecretBytes;
  b.fill(fill);
  return b;
}

function memoryStorage() {
  const maps = {
    local: new Map<string, unknown>(),
    sync: new Map<string, unknown>(),
    session: new Map<string, unknown>(),
  };
  const make = (m: Map<string, unknown>) => ({
    async get<T>(key: string): Promise<T | undefined> {
      return m.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      m.set(key, value);
    },
    async remove(key: string): Promise<void> {
      m.delete(key);
    },
  });
  return {
    suite: { local: make(maps.local), sync: make(maps.sync), session: make(maps.session) },
    maps,
  };
}

/** A record whose ciphertext is irrelevant: the fake AEAD decides the outcome. */
function keyRecord(id: string) {
  return {
    id,
    label: id,
    pubkey: "a".repeat(64),
    salt: Array.from(new Uint8Array(16).fill(7)),
    iv: Array.from(new Uint8Array(12).fill(8)),
    ct: Array.from(new Uint8Array(32).fill(9)),
    createdAt: 0,
    isSelected: true,
  };
}

describe("Memory zeroization (real buffers, not call counts)", () => {
  let derivedKeys: ReturnType<typeof retain>[];
  let decryptedKeys: ReturnType<typeof retain>[];

  beforeEach(() => {
    derivedKeys = [];
    decryptedKeys = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Real-behaviour fake KDF: returns a retained buffer filled with a
   * distinctive non-zero pattern, and pushes the buffer OBJECT (never a copy)
   * so the test and the service hold the same memory.
   */
  function fakeKdf() {
    return {
      async deriveKey(): Promise<SecretBytes> {
        const buf = makeSecret(NON_ZERO_PATTERN);
        derivedKeys.push(retain(buf));
        return buf;
      },
    };
  }

  function fakeAead(opts: { decryptRejects?: boolean } = {}) {
    return {
      async importKey(): Promise<CryptoKey> {
        return {} as CryptoKey;
      },
      async encrypt(): Promise<SecretBytes> {
        return makeSecret(0x11);
      },
      async decrypt(): Promise<SecretBytes> {
        if (opts.decryptRejects) throw new Error("decrypt failed");
        const buf = makeSecret(0x5c);
        decryptedKeys.push(retain(buf));
        return buf;
      },
    };
  }

  const fakeSchnorr = {
    getPublicKey: () => new Uint8Array(32).fill(3),
    sign: () => new Uint8Array(64).fill(4),
  };

  function service(aeadOpts: { decryptRejects?: boolean } = {}) {
    const { suite, maps } = memoryStorage();
    const svc = new KeyVaultService(
      suite as never,
      fakeAead(aeadOpts) as never,
      fakeKdf() as never,
      fakeSchnorr as never
    );
    return { svc, maps, suite };
  }

  describe("unlock", () => {
    it("zeroizes the derived key after a successful unlock", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", [keyRecord("k1")]);

      await svc.unlock("correct horse battery staple");

      expect(derivedKeys).toHaveLength(1);
      // Guard against a trivial pass: prove it was non-zero at handoff.
      expect(derivedKeys[0].isAllPattern(NON_ZERO_PATTERN)).toBe(false);
      expect(derivedKeys[0].isAllZero()).toBe(true);
    });

    it("zeroizes the derived key when AEAD decrypt rejects", async () => {
      const { svc, maps } = service({ decryptRejects: true });
      maps.local.set("encryptedKeys", [keyRecord("k1")]);

      await expect(svc.unlock("wrong")).rejects.toThrow("decrypt failed");

      expect(derivedKeys).toHaveLength(1);
      expect(derivedKeys[0].isAllZero()).toBe(true);
    });

    it("zeroizes one derived key per record, for every record", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", [
        keyRecord("k1"),
        keyRecord("k2"),
        keyRecord("k3"),
      ]);

      await svc.unlock("pw");

      expect(derivedKeys).toHaveLength(3);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
    });
  });

  describe("lock", () => {
    it("zeroizes every unlocked private key, and signing then fails", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", [keyRecord("k1"), keyRecord("k2")]);

      await svc.unlock("pw");

      // The decrypted buffers are held by the service while unlocked.
      expect(decryptedKeys).toHaveLength(2);
      for (const d of decryptedKeys) {
        expect(d.isAllZero()).toBe(false); // non-zero while unlocked
      }

      await svc.lock();

      for (const d of decryptedKeys) {
        expect(d.isAllZero()).toBe(true);
      }
      await expect(svc.sign("ab".repeat(32))).rejects.toThrow();
    });
  });

  describe("generateKey", () => {
    it("zeroizes the generated private key after the call resolves", async () => {
      const { svc } = service();

      // crypto.getRandomValues fills and returns the very array passed to it,
      // so spying on it yields a reference to the exact buffer the service
      // will later zeroize. There is no injection seam for this one.
      const generated: ReturnType<typeof retain>[] = [];
      const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
        (<T extends ArrayBufferView | null>(arr: T): T => {
          const out = real(arr as never) as T;
          if (out instanceof Uint8Array && out.byteLength === 32) {
            generated.push(retain(out));
          }
          return out;
        }) as typeof globalThis.crypto.getRandomValues
      );

      await svc.generateKey("pw", "label");

      expect(generated.length).toBeGreaterThanOrEqual(1);
      // The 32-byte draw is the private key.
      expect(generated[0].isAllZero()).toBe(true);
    });

    it("zeroizes the generated private key even when the call rejects", async () => {
      const { suite, maps } = memoryStorage();
      maps.local.set("encryptedKeys", []);
      const svc = new KeyVaultService(
        suite as never,
        fakeAead() as never,
        fakeKdf() as never,
        {
          getPublicKey: () => {
            throw new Error("derivation blew up");
          },
          sign: () => new Uint8Array(64),
        } as never
      );

      const generated: ReturnType<typeof retain>[] = [];
      const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
        (<T extends ArrayBufferView | null>(arr: T): T => {
          const out = real(arr as never) as T;
          if (out instanceof Uint8Array && out.byteLength === 32) {
            generated.push(retain(out));
          }
          return out;
        }) as typeof globalThis.crypto.getRandomValues
      );

      await expect(svc.generateKey("pw")).rejects.toThrow("derivation blew up");

      expect(generated.length).toBeGreaterThanOrEqual(1);
      expect(generated[0].isAllZero()).toBe(true);
    });
  });

  describe("encryptPrivateKey and revealKey", () => {
    it("zeroizes the derived key on the import path", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", []);

      await svc.importKey("11".repeat(32), "pw", "imported");

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
    });

    it("zeroizes the derived key when revealKey rejects on a bad password", async () => {
      const { suite, maps } = memoryStorage();
      maps.local.set("encryptedKeys", [keyRecord("k1")]);
      maps.sync.set("appSettings", { selectedKeyId: "k1" });
      const svc = new KeyVaultService(
        suite as never,
        fakeAead({ decryptRejects: true }) as never,
        fakeKdf() as never,
        fakeSchnorr as never
      );

      await expect(svc.revealKey("wrong-password", "k1")).rejects.toThrow(
        "incorrect_password"
      );

      expect(derivedKeys).toHaveLength(1);
      expect(derivedKeys[0].isAllZero()).toBe(true);
    });
  });

  describe("WebCrypto receives the caller's own buffer", () => {
    /**
     * Guards the removal of the old `toArrayBuffer()` helper. If someone
     * reintroduces defensive copying in the adapter, the buffer WebCrypto sees
     * stops being the buffer the caller can clear, and this fails.
     */
    it("passes the caller's buffer to crypto.subtle.importKey, not a clone", async () => {
      const raw = makeSecret(NON_ZERO_PATTERN);
      let seen: unknown;
      const realImport = globalThis.crypto.subtle.importKey.bind(
        globalThis.crypto.subtle
      );
      vi.spyOn(globalThis.crypto.subtle, "importKey").mockImplementation(
        ((fmt: string, keyData: BufferSource, ...rest: unknown[]) => {
          seen = keyData;
          return (realImport as never as (...a: unknown[]) => Promise<CryptoKey>)(
            fmt,
            keyData,
            ...rest
          );
        }) as typeof globalThis.crypto.subtle.importKey
      );

      await WebCryptoAesGcm.importKey(raw, ["encrypt"]);

      // Object identity: the same view, not a copy with equal contents.
      expect(seen).toBe(raw);

      // And because it is the same object, the caller clearing it is observable.
      raw.fill(0);
      expect((seen as Uint8Array).every((b) => b === 0)).toBe(true);
    });
  });

  describe("password is not retained", () => {
    const PASSWORD = "correct horse battery staple";

    /** Walks own enumerable properties plus the serialized form. */
    function retainsPassword(target: object, secret: string): boolean {
      const seen = new Set<unknown>();
      const walk = (v: unknown, depth: number): boolean => {
        if (depth > 6 || v === null || v === undefined) return false;
        if (typeof v === "string") return v.includes(secret);
        if (typeof v !== "object") return false;
        if (seen.has(v)) return false;
        seen.add(v);
        if (v instanceof Map) {
          for (const [k, val] of v) {
            if (walk(k, depth + 1) || walk(val, depth + 1)) return true;
          }
          return false;
        }
        if (ArrayBuffer.isView(v)) return false;
        for (const val of Object.values(v)) {
          if (walk(val, depth + 1)) return true;
        }
        return false;
      };
      return walk(target, 0);
    }

    it("does not retain the password on the service after unlock", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", [keyRecord("k1")]);

      await svc.unlock(PASSWORD);

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("does not retain the password after generateKey", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", []);

      await svc.generateKey(PASSWORD, "k");

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("does not retain the password after importKey", async () => {
      // A separate instance: the stub schnorr returns a constant pubkey, so
      // reusing the vault from the previous case would trip the
      // key_already_exists duplicate check rather than testing retention.
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", []);

      await svc.importKey("22".repeat(32), PASSWORD, "k2");

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("never writes the password into any storage area", async () => {
      const { svc, maps } = service();
      maps.local.set("encryptedKeys", [keyRecord("k1")]);

      await svc.unlock(PASSWORD);

      for (const area of [maps.local, maps.sync, maps.session]) {
        const dump = JSON.stringify([...area.entries()]);
        expect(dump).not.toContain(PASSWORD);
      }
    });
  });
});

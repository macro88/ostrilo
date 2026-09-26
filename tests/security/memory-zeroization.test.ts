import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { KeyVaultService } from "@/application/services/key-vault.service";
import {
  WebCryptoAesGcm,
  NobleSha256,
  ScureBech32,
} from "@/infrastructure/crypto/adapters";
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

const hexOf = (u: Uint8Array) =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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
      async deriveKey(password: string): Promise<SecretBytes> {
        // Must actually depend on the password: otherwise a wrong password
        // would still open the verifier and the "rejects on bad password"
        // tests would pass for the wrong reason.
        const buf = makeSecret(NON_ZERO_PATTERN);
        const pw = new TextEncoder().encode(password);
        for (let i = 0; i < pw.length; i++) buf[i % buf.length] ^= pw[i];
        derivedKeys.push(retain(buf));
        return buf;
      },
    };
  }

  /**
   * A real-behaviour in-memory AEAD. It genuinely round-trips, so the service's
   * envelope logic (verifier check, DEK wrap/unwrap, pubkey verification) runs
   * for real; only the cryptography is replaced. Ciphertexts are tagged with
   * their key and AAD so a mismatch rejects, exactly as AES-GCM would.
   */
  function fakeAead(opts: { decryptRejects?: boolean } = {}) {
    const vault = new Map<string, Uint8Array>();
    let seq = 0;
    const tag = (k: Uint8Array, aad: Uint8Array) =>
      `${hexOf(k)}|${hexOf(aad)}`;

    return {
      async importKey(raw: SecretBytes): Promise<CryptoKey> {
        // Snapshot the key bytes: the caller zeroizes `raw` right after, and a
        // real CryptoKey would have copied them internally anyway.
        return { __k: Uint8Array.from(raw) } as unknown as CryptoKey;
      },
      async encrypt(
        key: CryptoKey,
        _iv: SecretBytes,
        data: SecretBytes,
        aad: SecretBytes
      ): Promise<SecretBytes> {
        const k = (key as unknown as { __k: Uint8Array }).__k;
        const handle = `ct${seq++}`;
        vault.set(`${handle}:${tag(k, aad)}`, Uint8Array.from(data));
        const out = new Uint8Array(32) as SecretBytes;
        new TextEncoder().encodeInto(handle, out);
        return out;
      },
      async decrypt(
        key: CryptoKey,
        _iv: SecretBytes,
        data: SecretBytes,
        aad: SecretBytes
      ): Promise<SecretBytes> {
        if (opts.decryptRejects) throw new Error("decrypt failed");
        const k = (key as unknown as { __k: Uint8Array }).__k;
        const handle = new TextDecoder().decode(data).replace(/\0+$/, "");
        const found = vault.get(`${handle}:${tag(k, aad)}`);
        if (!found) throw new Error("aead_auth_failed");
        const buf = Uint8Array.from(found) as SecretBytes;
        if (buf.byteLength === 32) decryptedKeys.push(retain(buf));
        return buf;
      },
    };
  }

  // Derives a DISTINCT pubkey per secret key, so multi-key vaults do not all
  // collide on the duplicate-pubkey check, and so pubkey verification is a
  // real check rather than a tautology.
  const fakeSchnorr = {
    getPublicKey: (sk: Uint8Array) => {
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) out[i] = (sk[i] ?? 0) ^ 0x5a;
      return out;
    },
    sign: () => new Uint8Array(64).fill(4),
  };

  function service(aeadOpts: { decryptRejects?: boolean } = {}) {
    const { suite, maps } = memoryStorage();
    const svc = new KeyVaultService(
      suite as never,
      fakeAead(aeadOpts) as never,
      fakeKdf() as never,
      fakeSchnorr as never,
      // Real hash and bech32: neither touches secret material, so a fake
      // would only hide which buffers the service actually handles.
      NobleSha256,
      ScureBech32
    );
    return { svc, maps, suite };
  }

  describe("unlock", () => {
    it("zeroizes the key-encryption key after a successful unlock", async () => {
      const { svc } = service();
      await svc.generateKey("correct horse battery staple", "k1");
      derivedKeys.length = 0; // ignore the derivations from setup

      await svc.unlock("correct horse battery staple");

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) {
        // Guard against a trivial pass: prove it was non-zero at handoff.
        expect(d.isAllPattern(NON_ZERO_PATTERN)).toBe(false);
        expect(d.isAllZero()).toBe(true);
      }
    });

    it("zeroizes the KEK when the vault cannot be opened", async () => {
      const { svc } = service();
      await svc.generateKey("pw", "k1");
      derivedKeys.length = 0;

      await expect(svc.unlock("wrong-password")).rejects.toThrow();

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
    });

    it("derives exactly ONE key regardless of how many keys the vault holds", async () => {
      // This is the property that makes a memory-hard KDF affordable. The
      // previous design derived once per record, so a five-key vault paid five
      // times the cost and Argon2id was unaffordable by construction.
      const { svc } = service();
      await svc.generateKey("pw", "k1");
      await svc.importKey("11".repeat(32), "pw", "k2");
      await svc.importKey("22".repeat(32), "pw", "k3");
      derivedKeys.length = 0;

      await svc.unlock("pw");

      expect(
        derivedKeys,
        "unlock must derive the KEK once for the whole vault, not once per key record"
      ).toHaveLength(1);
      expect(derivedKeys[0].isAllZero()).toBe(true);
    });
  });

  describe("re-unlock", () => {
    it("zeroizes the keys it replaces when unlocking an unlocked vault", async () => {
      // vault.unlock is reachable in every state, so a second unlock over a
      // live session is ordinary. It used to clear the key map without
      // zeroizing it, leaving the first session's private keys in memory.
      const { svc } = service();
      await svc.generateKey("pw", "k1");
      await svc.importKey("44".repeat(32), "pw", "k2");
      await svc.unlock("pw");
      const firstSession = decryptedKeys.filter((d) => !d.isAllZero());
      expect(firstSession).toHaveLength(2);
      decryptedKeys.length = 0;

      await svc.unlock("pw");

      for (const d of firstSession) {
        expect(
          d.isAllZero(),
          "SECURITY REGRESSION: re-unlock left the previous session's private key in memory"
        ).toBe(true);
      }
      // And the vault is unlocked on fresh material, not on the cleared buffers.
      expect(decryptedKeys.filter((d) => !d.isAllZero())).toHaveLength(2);
      await expect(svc.sign("ab".repeat(32))).resolves.toBeDefined();
    });
  });

  describe("changePassword", () => {
    async function unlockedTwoKeyVault(aeadOpts: { decryptRejects?: boolean } = {}) {
      const setup = service(aeadOpts);
      await setup.svc.generateKey("old-pw", "k1");
      await setup.svc.importKey("55".repeat(32), "old-pw", "k2");
      await setup.svc.unlock("old-pw");
      derivedKeys.length = 0;
      decryptedKeys.length = 0;
      return setup;
    }

    it("zeroizes both KEKs and every DEK and round-tripped key on success", async () => {
      const { svc } = await unlockedTwoKeyVault();

      await svc.changePassword("old-pw", "new-pw");

      // The old KEK and the new one.
      expect(derivedKeys.length).toBeGreaterThanOrEqual(2);
      for (const d of derivedKeys) {
        expect(d.isAllPattern(NON_ZERO_PATTERN)).toBe(false);
        expect(d.isAllZero(), "a KEK outlived the password change").toBe(true);
      }
      // Every decrypt here is a DEK or a verification copy of a private key;
      // the session's live keys were decrypted before the change, not by it.
      expect(decryptedKeys.length).toBeGreaterThan(0);
      for (const d of decryptedKeys) {
        expect(d.isAllZero(), "a DEK or private-key copy outlived the change").toBe(true);
      }
      await expect(svc.sign("ab".repeat(32))).resolves.toBeDefined();
    });

    it("zeroizes the KEK when the current password is wrong", async () => {
      const { svc } = await unlockedTwoKeyVault();

      await expect(svc.changePassword("wrong-pw", "new-pw")).rejects.toThrow();

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
    });

    it("zeroizes everything when the commit fails", async () => {
      const { svc, suite } = await unlockedTwoKeyVault();
      suite.local.set = async () => {
        throw new Error("storage full");
      };

      await expect(svc.changePassword("old-pw", "new-pw")).rejects.toThrow("storage full");

      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
      for (const d of decryptedKeys) expect(d.isAllZero()).toBe(true);
    });
  });

  describe("lock", () => {
    it("zeroizes every unlocked private key, and signing then fails", async () => {
      const { svc } = service();
      await svc.generateKey("pw", "k1");
      await svc.importKey("33".repeat(32), "pw", "k2");
      decryptedKeys.length = 0;

      await svc.unlock("pw");

      // Every 32-byte decrypt is captured, which includes the wrapped-DEK
      // unwraps as well as the private keys. The DEKs are already cleared by
      // the time unlock returns, so the ones still non-zero here are exactly
      // the private keys the service is holding open.
      const live = decryptedKeys.filter((d) => !d.isAllZero());
      expect(
        live.length,
        "two keys were unlocked, so two private-key buffers should be live"
      ).toBe(2);

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
        } as never,
        NobleSha256,
        ScureBech32
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

  /**
   * The window between a secret being successfully acquired and the operation's
   * main body starting.
   *
   * The `generateKey` rejection test directly above induces its failure in
   * `schnorr.getPublicKey`, which is INSIDE the operation's `try`. A cleanup
   * block that begins after acquisition satisfies it while still leaking the
   * acquired KEK, so it cannot cover this window - these cases can.
   *
   * Every assertion here is on a buffer the operation OWNS: the KEK the KDF
   * handed it, and the 32-byte private-key draw. `generateKey` and `importKey`
   * do not unlock, so nothing is transferred to `this.unlocked` on these paths
   * and there is no intentionally-retained buffer to exempt. Do not widen these
   * to "every buffer reads zero" - an unlocked vault deliberately keeps
   * decrypted private keys live, which the `lock` test above covers instead.
   */
  describe("cleanup begins at acquisition, not at the operation body", () => {
    it("zeroizes the KEK when importKey's parser rejects the input", async () => {
      const { svc } = service();
      // Seed the envelope so the KEK under test is the one importKey derives,
      // not one created by the same call.
      await svc.generateKey("pw", "seed");
      derivedKeys.length = 0;

      await expect(svc.importKey("not-a-valid-nsec", "pw")).rejects.toThrow(
        "invalid_private_key_format"
      );

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) {
        expect(
          d.isAllPattern(NON_ZERO_PATTERN),
          "guard against a trivial pass: the KEK must have held bytes at handoff"
        ).toBe(false);
        expect(
          d.isAllZero(),
          "importKey acquired the KEK, then let the parser throw outside its cleanup"
        ).toBe(true);
      }
    });

    it("zeroizes the KEK when the RNG throws on generateKey's private-key draw", async () => {
      const { svc } = service();

      // Throw ONLY on the private-key draw. `randomBytes` is also the single
      // CSPRNG entry point for the KDF salt (16 bytes) and the IVs (12), so an
      // ungated stub would fail this test for an unrelated reason. Gating on
      // "32 bytes, after the KEK exists" names the private key unambiguously:
      // the DEK is also 32 bytes but is drawn inside `sealPrivateKey`, which
      // runs later and inside the operation's `try`.
      const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
        (<T extends ArrayBufferView | null>(arr: T): T => {
          if (
            arr instanceof Uint8Array &&
            arr.byteLength === 32 &&
            derivedKeys.length >= 1
          ) {
            throw new Error("rng_unavailable");
          }
          return real(arr as never) as T;
        }) as typeof globalThis.crypto.getRandomValues
      );

      await expect(svc.generateKey("pw", "label")).rejects.toThrow(
        "rng_unavailable"
      );

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) {
        expect(d.isAllPattern(NON_ZERO_PATTERN)).toBe(false);
        expect(
          d.isAllZero(),
          "generateKey acquired the KEK, then drew the private key outside its cleanup"
        ).toBe(true);
      }
    });

    it("zeroizes the KEK when persisting a newly created envelope fails", async () => {
      // A vault with no envelope, so the write creates one: `createEnvelope`
      // succeeds and hands out a live KEK, then `saveEnvelope` rejects.
      const { suite } = memoryStorage();
      const failingSuite = {
        ...suite,
        local: {
          ...suite.local,
          async set<T>(key: string, value: T): Promise<void> {
            if (key === "vaultEnvelope") throw new Error("storage_write_failed");
            await suite.local.set<T>(key, value);
          },
        },
      };
      const svc = new KeyVaultService(
        failingSuite as never,
        fakeAead() as never,
        fakeKdf() as never,
        fakeSchnorr as never,
        NobleSha256,
        ScureBech32
      );

      await expect(svc.generateKey("pw", "k1")).rejects.toThrow(
        "storage_write_failed"
      );

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) {
        expect(d.isAllPattern(NON_ZERO_PATTERN)).toBe(false);
        expect(
          d.isAllZero(),
          "kekForWrite created the envelope, then persisted it outside its cleanup"
        ).toBe(true);
      }
    });
  });

  describe("encryptPrivateKey and revealKey", () => {
    it("zeroizes the derived key on the import path", async () => {
      const { svc } = service();

      await svc.importKey("11".repeat(32), "pw", "imported");

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
    });

    it("zeroizes the derived key when revealKey rejects on a bad password", async () => {
      const { svc } = service();
      const rec = await svc.generateKey("pw", "k1");
      derivedKeys.length = 0;

      await expect(svc.revealKey("wrong-password", rec.id)).rejects.toThrow(
        "incorrect_password"
      );

      expect(derivedKeys.length).toBeGreaterThanOrEqual(1);
      for (const d of derivedKeys) expect(d.isAllZero()).toBe(true);
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
      const { svc } = service();
      await svc.generateKey(PASSWORD, "k1");

      await svc.unlock(PASSWORD);

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("does not retain the password after generateKey", async () => {
      const { svc } = service();

      await svc.generateKey(PASSWORD, "k");

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("does not retain the password after importKey", async () => {
      // A separate instance: the stub schnorr returns a constant pubkey, so
      // reusing the vault from the previous case would trip the
      // key_already_exists duplicate check rather than testing retention.
      const { svc } = service();

      await svc.importKey("22".repeat(32), PASSWORD, "k2");

      expect(retainsPassword(svc, PASSWORD)).toBe(false);
    });

    it("never writes the password into any storage area", async () => {
      const { svc, maps } = service();
      await svc.generateKey(PASSWORD, "k1");

      await svc.unlock(PASSWORD);

      for (const area of [maps.local, maps.sync, maps.session]) {
        const dump = JSON.stringify([...area.entries()]);
        expect(dump).not.toContain(PASSWORD);
      }
    });
  });
});

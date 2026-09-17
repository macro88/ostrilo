## Why

Every encrypted key record in the vault is stored without a format version and without the KDF parameters that produced it. `KeyRecord` (`src/domain/types.ts:13`) carries only `id`, `label`, `pubkey`, `ct`, `iv`, `salt`, `createdAt`, `lastUsedAt`, and `isSelected`. The algorithm and the iteration count live in code, not in the record, so the vault has no way to say "this ciphertext was produced by PBKDF2 at 100,000 iterations". Without that statement, key derivation can never be strengthened later without a migration that guesses at how each existing record was encrypted, and a wrong guess means an unreadable key. This is the most time-sensitive item in the project: no real user key exists yet, so adding the version and parameter fields costs nothing today and becomes an irreversible data-migration problem the moment someone stores a key they cannot afford to lose.

The parameters themselves are also weak. `NoblePbkdf2` runs `pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 })` (`src/infrastructure/crypto/adapters.ts:57`), roughly six times below current OWASP guidance of 600,000 iterations for PBKDF2-HMAC-SHA256, and PBKDF2 is not memory-hard, which makes it the exact workload GPUs are best at. At around 10^6 guesses per second on one inexpensive rig, a typical eight-character human password falls in under five minutes. The implementation is also pure JavaScript rather than WebCrypto `crypto.subtle.deriveBits`, so it is roughly five to ten times slower than native; a native PBKDF2 at 600,000 iterations would cost the user less wall-clock time than the current pure-JS 100,000 costs today. Meanwhile the file header of `src/domain/utils/crypto.ts:6` cites NS-N-001 as requiring Argon2id and the comment at `src/domain/utils/crypto.ts:176` claims the downgrade to PBKDF2 was made "for browser compatibility". That justification is false: the installed `@noble/hashes@2.2.0` ships `argon2.js` with both `argon2id` and an `argon2idAsync` variant that yields to the scheduler, and it runs in an MV3 service worker.

## What Changes

- **BREAKING** (storage format, pre-release): add a version discriminator and an explicit KDF parameter block to the stored vault format, and read derivation parameters from the record instead of from code constants.
- Introduce a key-encryption-key / data-encryption-key envelope so one password derivation unlocks the whole vault. Today `unlock()` (`src/application/services/key-vault.service.ts:300-346`) runs the KDF once per key record because every record has its own salt; five keys at 600,000 iterations is three million iterations per unlock, which makes strong parameters unaffordable.
- Move key derivation to Argon2id with recorded memory, time, and parallelism parameters, with native WebCrypto PBKDF2 at OWASP-current iterations as the documented interim option.
- Bind each ciphertext to its record metadata with AES-GCM additional authenticated data. Encryption and decryption currently pass no `additionalData` (`src/infrastructure/crypto/adapters.ts:34`), so nothing stops an attacker with storage write access from swapping ciphertexts between records, rolling back stored KDF parameters, or substituting their own vault entry.
- Verify after decryption that the recovered private key actually derives the record's stored `pubkey`. Unlock never checks this today.
- Isolate per-record failures. The `Promise.all` in `unlock()` rejects wholesale, so one corrupted or tampered record makes the entire vault un-unlockable and `LockScreen` reports it to the user as "Incorrect password" (`src/ui/features/authentication/components/LockScreen.tsx:53`).
- Require a real password verification path when the vault holds zero key records. `records.map` over an empty array resolves immediately and `unlock()` then unconditionally writes `isLocked: false`, so an empty vault unlocks with any password, including an empty-ish one that clears validation.
- Add a lazy re-encrypt-on-unlock migration that treats any record without a version field as legacy PBKDF2-100k, plus rollback and a no-key-loss failure policy.
- Reconcile the documentation contradiction: correct the false "browser compatibility" comment and align `docs/ostrilo-signer-requirements.md` NS-N-001 and `docs/v2-prd.md` SEC-015 with the shipped algorithm.

No password-strength policy changes, no backup or export format changes, no WebAuthn or hardware-key unlock, and no Web Worker isolation of crypto ship in this change.

## Capabilities

### New Capabilities

- `vault-key-derivation`: Versioned, self-describing vault encryption: recorded KDF parameters, memory-hard derivation, a single-derivation KEK/DEK envelope, AAD binding of ciphertext to record metadata, decrypted-key verification against the stored pubkey, and lazy migration of legacy records.

### Modified Capabilities

- `key-vault`: "Zero-Retention Password Handling" gains a real password verification requirement for the empty-vault case and covers the single-derivation unlock path; "Memory Zeroization" extends to the new KEK and DEK buffers introduced by the envelope.

## Impact

- Domain types: `KeyRecord` in `src/domain/types.ts` needs a version discriminator and a KDF parameter block, and the vault needs a record for the envelope-level wrapped DEK material.
- Crypto port: `CryptoKdf.deriveKey(password, salt)` in `src/application/ports/crypto.ts:18` cannot express Argon2id memory/time/parallelism or per-record parameters and must take a parameter object. `CryptoAead.encrypt`/`decrypt` must accept additional authenticated data.
- Crypto adapters: `src/infrastructure/crypto/adapters.ts` needs an Argon2id adapter over `@noble/hashes/argon2.js`, an optional native WebCrypto PBKDF2 adapter, and AAD pass-through in `WebCryptoAesGcm`.
- Key vault service: `encryptPrivateKey`, `validatePasswordAgainstExistingKeys`, `generateKey`, `importKey`, `unlock`, and `revealKey` in `src/application/services/key-vault.service.ts` all derive keys directly from the password and must move to the envelope. `validatePasswordAgainstExistingKeys` currently validates against only `records[0]`.
- Background composition: `src/extension/background.ts:212` injects `NoblePbkdf2` into `KeyVaultService` and must inject the new KDF adapter.
- Duplicate implementation: `deriveKeyFromPassword`, `encryptPrivateKey`, and `decryptPrivateKey` in `src/domain/utils/crypto.ts` hard-code PBKDF2 at 100,000 iterations in a second place. This change must not leave the two implementations disagreeing; deeper consolidation belongs to the separate `consolidate-crypto-implementations` change.
- RPC surface: `vault.unlock` in `src/infrastructure/messaging/handlers/vault-rpc.ts:63-79` returns unlock failures without distinguishing a wrong password from a damaged record, and needs distinct error codes.
- Unlock UX: unlock will become slower and needs progress or pending affordances in `LockScreen`, plus honest error copy for the damaged-record case.
- Storage: the `encryptedKeys` local-storage array gains new fields; `tests/security/crypto-security.test.ts:357` and `tests/unit/application/keyvault.service.test.ts:70` construct or inspect that shape directly.
- Tests: unit coverage for the envelope, versioning, and migration; security coverage for AAD tamper rejection, pubkey verification, empty-vault password verification, and KDF parameter assertions.
- Documentation: `docs/ostrilo-signer-requirements.md` NS-N-001, `docs/v2-prd.md` SEC-015, and the misleading comments in `src/domain/utils/crypto.ts`.

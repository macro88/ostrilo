## Context

The vault encrypts each private key independently, and the format is entirely implicit in code.

`KeyRecord` (`src/domain/types.ts:13`) stores `id`, `label`, `pubkey`, `ct`, `iv`, `salt`, `createdAt`, `lastUsedAt`, and `isSelected`. There is no version field and no KDF parameter block. `NoblePbkdf2` (`src/infrastructure/crypto/adapters.ts:55-59`) is the only thing that knows the ciphertext came from PBKDF2-HMAC-SHA256 at 100,000 iterations, and the port it satisfies, `CryptoKdf.deriveKey(password, salt)` (`src/application/ports/crypto.ts:18-20`), cannot express any cost parameter at all. The moment that constant changes, every stored record becomes undecryptable with no way to detect why.

`KeyVaultService` derives from the password in five separate places: `encryptPrivateKey` (line 81), `validatePasswordAgainstExistingKeys` (line 112), `unlock` (line 316), and `revealKey` (line 494). `unlock` runs the derivation inside `records.map`, so the cost is linear in key count: five keys at 600,000 iterations would be three million iterations per unlock. That structure is the reason strong parameters look unaffordable, and the `Promise.all` wrapper means one bad record rejects the whole unlock. `LockScreen` (`src/ui/features/authentication/components/LockScreen.tsx:53`) renders whatever that rejection produces and falls back to "Incorrect password", so a corrupted record is indistinguishable from a typo. When `records` is empty, `records.map` produces nothing, `Promise.all([])` resolves, and the code falls straight through to writing `isLocked: false` (lines 339-343) without ever having touched the password.

`WebCryptoAesGcm.encrypt`/`decrypt` (`src/infrastructure/crypto/adapters.ts:29-52`) pass no `additionalData`, so a ciphertext is not bound to anything. An attacker who can write `chrome.storage.local` can move ciphertexts between records, rewrite the salt or (once parameters are stored) the cost parameters, or replace a record's `pubkey` with their own. Nothing in `unlock` checks that the decrypted 32 bytes actually derive the `pubkey` the record claims.

Two constraints shape the fix. First, `src/domain/utils/crypto.ts` contains a parallel PBKDF2/AES-GCM implementation (`deriveKeyFromPassword`, `encryptPrivateKey`, `decryptPrivateKey`) whose header cites NS-N-001 as requiring Argon2id while line 176 claims PBKDF2 was chosen "for browser compatibility". That claim is false: `@noble/hashes@2.2.0` ships `argon2.js` exporting `argon2id` and `argon2idAsync`, and it runs in an MV3 service worker. Second, and decisively, no real user key exists yet. Adding a version field and a parameter block today is a schema edit; adding it after a user stores an irreplaceable identity is a migration with data-loss risk.

## Goals / Non-Goals

**Goals:**

- Make the stored format self-describing: a version discriminator and the full KDF parameter set travel with every record.
- Make derivation memory-hard and bring cost parameters up to current guidance.
- Make unlock cost independent of key count so strong parameters stay affordable.
- Bind every ciphertext to its record metadata so storage-write access cannot rearrange or downgrade the vault.
- Verify decrypted keys against their stored public key before admitting them for signing.
- Distinguish a wrong password from a damaged record, in the service and in the UI.
- Require real password verification for the zero-key case.
- Migrate any pre-existing unversioned record without ever putting a key at risk.
- Remove the false "browser compatibility" justification and reconcile NS-N-001 and SEC-015 with what ships.

**Non-Goals:**

- No change to password strength rules or the password entry UX beyond a pending state and honest error copy; that is `enforce-password-policy`.
- No full merge of `src/domain/utils/crypto.ts` into the adapters; that is `consolidate-crypto-implementations`. This change only stops the two implementations from disagreeing about the format.
- No backup, export, or recovery-phrase format work; that is `secure-key-backup-flow`.
- No WebAuthn, biometric, or hardware-backed unlock.
- No Web Worker or sandboxed-context isolation of crypto operations.
- No re-keying UI, no user-visible KDF tuning slider, and no vault password change flow.

## Decisions

### Decision 1: Version and KDF parameters live in the stored data

Records carry a numeric `v` discriminator, and the KDF parameters live in an explicit block rather than a bare `salt` array:

```
kdf:
  | { alg: "argon2id"; salt: number[]; m: number; t: number; p: number; dkLen: number }
  | { alg: "pbkdf2-sha256"; salt: number[]; iterations: number; dkLen: number }
```

Read paths take the parameters from the stored block. Code constants are used only when writing new material.

`v` is a number, not a string, and it is checked before anything else is parsed. A version this build does not recognise is a hard stop: no decryption attempt, no rewrite, no delete, and an error code distinct from a wrong password. An absent `v` means legacy PBKDF2-100k.

**Rationale:** This is the whole point of the change. Without it, every future parameter increase is a blind migration. With it, a record states how to read itself, so parameters can be raised at any time and old records stay readable until they are lazily rewritten.

**Alternative considered:** Keep parameters in code and version the whole storage entry with a single global number. That works only while every record shares one parameter set, which is exactly what breaks during a lazy migration, when strong and legacy records coexist.

**Alternative considered:** Encode the parameters into the ciphertext as a PHC-style string prefix (`$argon2id$v=19$m=65536,t=3,p=1$...`). Compact and standard, but it puts parsing in the hot path, hides the fields from storage inspection in tests, and does not fit the existing `number[]` storage shape.

### Decision 2: One password-derived KEK per vault, one DEK per key

A single vault-level envelope holds the password-derived material; each key record holds a wrapped data-encryption key.

```
vaultEnvelope (storage key "vaultEnvelope", local):
  v: 1
  kdf: { alg: "argon2id", salt, m, t, p, dkLen }
  verifier: { iv: number[], ct: number[] }   // AES-GCM(KEK, iv, VERIFIER_CONSTANT)
  createdAt, updatedAt

KeyRecord (storage key "encryptedKeys", local):
  v: 1
  id, label, pubkey, createdAt, lastUsedAt, isSelected     // unchanged fields
  wrappedDek: { iv: number[], ct: number[] }               // AES-GCM(KEK, iv, DEK)
  ct: number[], iv: number[]                               // AES-GCM(DEK, iv, privateKey)
```

Unlock becomes: derive KEK once from `vaultEnvelope.kdf` → decrypt `verifier` → for each record, unwrap `wrappedDek` with the KEK, decrypt `ct` with the DEK, verify the recovered key against `pubkey`, zeroize the DEK. Adding a key while unlocked derives the KEK once for that operation, generates a fresh 32-byte DEK, and wraps it.

The envelope is a separate storage entry rather than a field on the key array so that reading and writing the parameter block does not require rewriting every record, and so a vault can have a password with zero keys.

`validatePasswordAgainstExistingKeys` (line 97) disappears. It currently tests the password against `records[0]` only, which is both incomplete and an extra derivation; the `verifier` replaces it with one AEAD operation that is exact for the whole vault.

**Rationale:** Unlock cost becomes O(1) in the KDF and O(n) in cheap AES-GCM operations. That is what makes Argon2id at 64 MiB affordable at all. It also gives the vault a single password-verification point, which is what fixes the empty-vault hole.

**Alternative considered:** Keep per-record derivation and accept the cost. At five keys, any parameter set strong enough to matter produces an unlock the user will abandon.

**Alternative considered:** One shared salt across records, still deriving per record. Same derived key every time, so it is the envelope with extra steps and no verification point.

### Decision 3: AAD binds version, KDF parameters, record identity, and public key

Every AES-GCM call over vault material passes additional authenticated data built by a fixed-field, explicitly ordered encoder (not `JSON.stringify` over an object literal, so field order cannot drift with a refactor). Three domain-separated shapes:

| Blob | Key | AAD fields |
| --- | --- | --- |
| `verifier` | KEK | `"ostrilo/vault-verifier"`, `v`, canonical `kdf` |
| `wrappedDek` | KEK | `"ostrilo/vault-dek"`, `v`, canonical `kdf`, `id`, `pubkey` |
| `ct` | DEK | `"ostrilo/vault-sk"`, `v`, `id`, `pubkey` |

What each bound field blocks:

- **`v`** — rollback. Without it, an attacker rewrites `v` to the legacy value and the reader applies legacy parsing rules to modern material, or the reverse.
- **canonical `kdf`** — parameter downgrade. This is the field that makes stored parameters safe to store at all. Rewriting `m: 65536` to `m: 8` or `iterations: 600000` to `iterations: 1` would otherwise turn the vault into a trivially crackable one on the next unlock.
- **`id`** — cross-record substitution. Copying record B's `ct` and `wrappedDek` into record A's slot no longer authenticates, so an attacker cannot make the "Personal" key slot hold the key from the "Testing" slot.
- **`pubkey`** — identity substitution. An attacker cannot repoint a record at a public key they control while leaving the ciphertext in place, and cannot leave a stale `pubkey` displayed in the UI over swapped ciphertext.
- **domain tag** — slot confusion. A `verifier` blob cannot be replayed into the `wrappedDek` slot or vice versa.

`label`, `isSelected`, `createdAt`, and `lastUsedAt` are deliberately **not** bound. Renaming a key, selecting it, or touching its timestamps must not require re-encryption. Those fields are integrity-relevant only cosmetically, and binding them would make routine UI actions into crypto operations.

Because AAD failures and wrong-password failures are both `OperationError` from WebCrypto, the service distinguishes them structurally, not by inspecting the exception: the `verifier` decrypts first. If the `verifier` fails, the password is wrong. If the `verifier` succeeds and a record then fails, the password was right and that record is damaged or tampered.

**Rationale:** That ordering is the cheap, reliable answer to findings 5 and 7 at once. One AEAD operation resolves the password question before any per-record work begins.

**Alternative considered:** A separate HMAC over record metadata. More moving parts, another key to derive and zeroize, and AES-GCM already accepts AAD for free.

**Alternative considered:** Sign the whole `encryptedKeys` array with a single MAC. Detects tampering but not which record, so it cannot support per-record isolation, and any legitimate write requires the KEK.

### Decision 4: Argon2id at m=65536 KiB, t=3, p=1, dkLen=32, with native PBKDF2 as the interim path

Primary: `argon2idAsync` from `@noble/hashes/argon2.js` with `m: 65536` (64 MiB), `t: 3`, `p: 1`, `dkLen: 32`, a 16-byte random salt, and `asyncTick` set so the derivation yields to the event loop. `p: 1` because the background context is single-threaded; RFC 9106's second recommended option uses `p: 4`, which buys nothing without threads. This sits comfortably above the OWASP Argon2id minimum of 19 MiB / t=2 / p=1.

Interim and fallback: PBKDF2-HMAC-SHA256 at 600,000 iterations via `crypto.subtle.deriveBits`, not `@noble/hashes/pbkdf2.js`. Native is roughly 5-10x faster than the pure-JS path, so native at 600,000 iterations costs the user less wall-clock time than today's pure-JS 100,000. WebCrypto is already the AES-GCM provider (`src/infrastructure/crypto/adapters.ts:16-28`), so this adds no new capability, only a second `deriveBits` call.

Target: a single unlock derivation completes in **under 1 second on a mid-range laptop**, with 300-800 ms as the comfortable band. The parameters above must be measured against that budget before they ship. If pure-JS Argon2id at 64 MiB / t=3 exceeds the budget on the reference machine, the resolution is to ship the native PBKDF2-600k path as the recorded `alg` and revisit Argon2id — **not** to weaken Argon2id below the recorded floor. Because the parameters live in the record, that decision is reversible per record at any later date, which is the entire benefit of Decision 1.

`CryptoKdf` changes from `deriveKey(password, salt)` to a parameter-object signature so the port can carry either algorithm's cost fields, and `CryptoAead.encrypt`/`decrypt` gain an `aad` argument.

**Rationale:** Argon2id is what the code's own header already claims (`src/domain/utils/crypto.ts:6`), it is memory-hard, and the dependency is already installed. Memory-hardness is the property that matters here: PBKDF2 is the workload GPUs are best at, and at ~10^6 guesses/sec an eight-character human password falls in minutes.

**Alternative considered:** scrypt, also shipped by `@noble/hashes`. Memory-hard and well understood, but Argon2id is the current recommendation, is what NS-N-001 already names, and offers independent time and memory knobs.

**Alternative considered:** Native PBKDF2 only, skipping Argon2id. Cheapest to ship and a real improvement, but it leaves the vault non-memory-hard and leaves the documentation contradiction standing. Kept as the fallback rung, not the destination.

### Decision 5: Verify the decrypted key against the stored public key, and isolate record failures

After decrypting a record, derive the public key from the recovered 32 bytes via the existing `Schnorr` port and compare against `record.pubkey`. On mismatch: zeroize the plaintext, do not add it to `this.unlocked`, and mark the record damaged.

`unlock` stops being `Promise.all` over records and returns a result that names outcomes per record:

```
{ selectedKeyId?: string; unlockedKeyIds: string[]; damagedKeyIds: string[] }
```

Sequencing:

1. Load `vaultEnvelope`. Absent and no records → `vault_not_created`. Absent but legacy records present → legacy path (Decision 6).
2. Unknown `v` → `unsupported_vault_version`.
3. Recorded parameters below the accepted floor → `vault_parameters_downgraded`.
4. Derive the KEK once. Decrypt `verifier`. Failure → `incorrect_password`, vault stays locked.
5. Per record, in an individual try/catch: unwrap the DEK, decrypt, verify against `pubkey`, zeroize the DEK. Failures accumulate into `damagedKeyIds`.
6. Write `isLocked: false` only if step 4 succeeded.

If every record is damaged but the `verifier` succeeded, the vault still unlocks and the UI says stored key data is damaged or has been altered. It must never say the password was wrong, because at that point the extension knows it was right.

`vault-rpc.ts` gains error codes for `unsupported_vault_version`, `vault_parameters_downgraded`, `vault_record_damaged`, and `vault_not_created`, so `LockScreen` stops rendering all of them as "Incorrect password".

**Rationale:** These two findings share one root cause — unlock treats "this record failed" and "this password is wrong" as the same event. Splitting password verification out of the per-record loop resolves both.

**Alternative considered:** Fail the whole unlock on any damaged record. Safer-looking, but it means one corrupted byte in one record locks a user out of every other key they own, with no diagnosis.

### Decision 6: Lazy re-encrypt on unlock, write-verify-then-delete

A record with no `v` is legacy PBKDF2-100k. Migration happens after the password is proven against that record, never before, and never destructively.

Legacy-only vault (no `vaultEnvelope`):

1. Derive the legacy key from `password` and `record.salt` using PBKDF2-SHA256 at 100,000 iterations with no AAD, exactly as today.
2. Decrypt. Failure on **every** legacy record → `incorrect_password`.
3. On the first success, the password is proven. Create `vaultEnvelope` with fresh Argon2id parameters and a fresh salt, derive the KEK, write the `verifier`.
4. For each legacy record whose plaintext was recovered: generate a DEK, encrypt the key with AAD, wrap the DEK, and write the record as a **new** entry carrying `v: 1`.
5. Read the new entry back, decrypt it, and verify the recovered key against `pubkey`.
6. Only after step 5 succeeds, remove the legacy fields from that entry.
7. If any step 3-5 fails, keep the legacy entry byte-for-byte as it was, keep the key available for signing in this session, and record that the record is still legacy. Retry on the next unlock.

Mixed vaults are the normal state mid-migration and must unlock: records are dispatched on `v` per record, so a `v: 1` record and an unversioned record coexist without special casing. A legacy record that fails to decrypt while the `verifier` succeeds is damaged, not a wrong password.

Because storage writes are not transactional, step 4 writes the new material into the same record object alongside the legacy `salt`, and step 6 deletes the legacy `salt`. A record that has both is a record mid-migration and is readable by the `v: 1` path. A crash therefore leaves a readable record in every window.

**Rationale:** No user has a real key yet, so in practice this path will run against zero or one development record. It still has to be written correctly, because "no user has a key yet" stops being true on the first install after release, and the cost of getting it wrong is an unrecoverable identity.

**Alternative considered:** Eager migration on extension update, without the password. Impossible — the password is required to read legacy material, and it is not retained.

**Alternative considered:** Force a re-import. Correct only for users who kept their `nsec` elsewhere, which is exactly the assumption a key manager must not make.

**Rollback:** Reverting the code while a migrated `v: 1` record exists would leave that record unreadable, since the old build has no envelope, no AAD, and no Argon2id. So rollback is gated on the migration having run. Before any record reaches `v: 1`, reverting is a clean code revert. After, rollback requires either shipping the reverted build with the read side of the `v: 1` path retained, or having the user re-import from backup. The safest ordering is therefore to land the read side of `v: 1` and keep it, permanently — the version discriminator exists precisely so that read support is cheap to retain forever.

### Decision 7: Empty vault reports "no vault", not "unlocked"

Today, zero records means unlock succeeds with any password. The reachable paths are a pre-onboarding profile and a profile whose `encryptedKeys` entry was cleared while other state survived.

With the envelope:

- No `vaultEnvelope` and no records → `vault_not_created`. Not unlocked.
- `vaultEnvelope` present, zero records → the `verifier` decides. Correct password unlocks a vault with nothing available for signing; wrong password is `incorrect_password`.

The envelope is created when the first key is created or imported, which is the point at which the user first chooses a password.

**Rationale:** "Nothing to decrypt" is not evidence of anything. An unlocked-but-unverified session is a state the rest of the extension trusts, and it should not be reachable by pressing Unlock on a blank vault.

**Alternative considered:** Store a password hash for the empty case. That is a second secret-derived artifact to get right; the `verifier` already exists and is bound to the same AAD.

## Risks / Trade-offs

- [Risk] **Unlock latency regression.** Argon2id at 64 MiB / t=3 in pure JavaScript is far slower than PBKDF2-100k, and unlock is the most frequent password interaction in the product. → Mitigation: measure before shipping and hold the sub-1-second budget on a mid-range laptop; the KEK/DEK envelope makes the cost independent of key count, so the regression does not compound with a growing vault; `argon2idAsync` with `asyncTick` keeps the runtime responsive; `LockScreen` shows a pending state and disables resubmission; if the budget cannot be met, ship native PBKDF2-600k as the recorded algorithm and raise it later per record.
- [Risk] **Service-worker memory limits for a 64 MiB Argon2id allocation.** An MV3 service worker is a constrained, terminable context, and a 64 MiB typed array is a large single allocation there. → Mitigation: measure actual peak memory in the Chrome MV3 build and the Firefox MV2 build before committing to `m: 65536`; allocate inside the derivation and drop the reference immediately so the buffer is collectable; never hold the buffer across unlock attempts; keep `asyncTick` short enough that the worker is not judged idle mid-derivation; treat an allocation failure as a fall-through to the native PBKDF2 path rather than an unlock failure.
- [Risk] **Service-worker termination mid-derivation.** Yielding to the event loop for a multi-hundred-millisecond derivation raises the chance the worker is torn down before the unlock completes. → Mitigation: the derivation runs inside a single `vault.unlock` RPC handler invocation, which keeps the worker alive for the response; a torn-down derivation leaves storage untouched and the user retries.
- [Risk] **Migration data loss.** A partially written migration could leave a record that neither the legacy path nor the new path can read. → Mitigation: write-verify-then-delete, with the legacy `salt` retained until the `v: 1` material has been read back and verified against `pubkey`; never delete or overwrite a record on a failed migration; keep the recovered key usable for the current session even when re-encryption fails; cover the interrupted case with a test that asserts the legacy record survives.
- [Risk] **Rollback after migration strands keys.** A build without the `v: 1` read path cannot read migrated records. → Mitigation: retain the `v: 1` read path permanently once shipped, and gate any revert on whether migration has run; document that the version discriminator exists to make read support cheap to keep.
- [Risk] **Two crypto implementations diverging.** `src/domain/utils/crypto.ts` hard-codes PBKDF2-100k in a second place, and `EncryptedKey` there has the same `{ct, iv, salt}` shape as the legacy record. Updating only the adapters leaves a code path that silently writes legacy material. → Mitigation: within this change, restrict the domain-utils encrypt/decrypt helpers to the legacy read path or remove their write side, and correct the false comment at line 176 and the header at line 6; full consolidation stays with `consolidate-crypto-implementations`.
- [Risk] **New error codes break existing UI and test assumptions.** `LockScreen` renders `error.message` directly and `vault-rpc.ts` maps only `incorrect_password`. → Mitigation: add the new codes with explicit copy, and update `tests/unit/application/keyvault.service.test.ts` and `tests/security/crypto-security.test.ts`, both of which construct or inspect the raw record shape.
- [Trade-off] **The record now advertises its own KDF parameters to an attacker who reads storage.** → Accepted: the parameters were already knowable from the shipped source, and binding them into the AAD is what makes storing them a net gain rather than a new attack surface.
- [Trade-off] **`label` and `isSelected` are unauthenticated.** An attacker with storage write access can relabel a key or change which key is selected. → Accepted for now: the approval UI shows the public key for the signing identity, and binding cosmetic fields would turn a rename into a re-encryption. Worth revisiting if the approval surface ever relies on `label` alone.

## Migration Plan

1. Land the schema and port changes first: `v` and `kdf` on the record, the `vaultEnvelope` entry, the `aad` argument on `CryptoAead`, and the parameter object on `CryptoKdf`. Nothing is migrated yet; the write path still produces the current format.
2. Land the Argon2id adapter and the native PBKDF2 adapter behind the port, with measured derivation timings recorded in the task notes.
3. Switch the write path to `v: 1`: new keys created or imported from this point are envelope-format from birth. This is the step that matters most, because it is the step that must precede any real user key.
4. Land the `v: 1` read path, the `verifier`-first password check, per-record isolation, and pubkey verification.
5. Land the legacy read path and the lazy write-verify-then-delete migration. Verify against a fixture vault built by the pre-change code: one legacy record, then two, then a mixed vault.
6. Verify the interrupted-migration case explicitly: kill the write between the new-material write and the legacy-field delete, and assert the record still unlocks.
7. Update `docs/ostrilo-signer-requirements.md` NS-N-001, `docs/v2-prd.md` SEC-015, and the comments in `src/domain/utils/crypto.ts`.
8. Rollback: before step 5 has run on a given profile, revert the code. After, keep the `v: 1` read path in place; do not ship a build that cannot read `v: 1`.

## Open Questions

- What is the measured `argon2idAsync` time and peak memory for `m: 65536, t: 3, p: 1` in the Chrome MV3 service worker and the Firefox MV2 background page on the reference machine? The choice between shipping Argon2id now and shipping native PBKDF2-600k as the interim rung depends entirely on that number.
- Should the vault expose a re-key operation so an existing user can move to stronger parameters on demand, or is lazy migration on unlock sufficient until a password-change flow exists?
- Should a damaged record be surfaced anywhere beyond the unlock error, for example as a persistent warning in Settings with a re-import affordance?
- Should `verifier` be a fixed constant or include the envelope `createdAt`, so that two vaults with the same password do not produce byte-identical verifier ciphertexts? The salt already differs, so the derived KEK differs; the question is whether the extra binding is worth the field.

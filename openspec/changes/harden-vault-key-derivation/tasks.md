## 1. Measure Before Committing To Parameters

- [ ] 1.1 Write a throwaway benchmark that runs `argon2idAsync` from `@noble/hashes/argon2.js` at `m: 65536, t: 3, p: 1, dkLen: 32` and record wall-clock time on the reference laptop.
- [ ] 1.2 Run the same benchmark inside the Chrome MV3 service worker and the Firefox MV2 background page, and record time plus peak memory for each.
- [ ] 1.3 Benchmark native `crypto.subtle.deriveBits` PBKDF2-HMAC-SHA256 at 600,000 iterations in both browser contexts as the interim comparison point.
- [ ] 1.4 Record all measurements in this change directory and decide whether `v: 1` ships with `alg: "argon2id"` or `alg: "pbkdf2-sha256"`, holding the sub-1-second unlock budget.

## 2. Storage Schema And Ports

- [ ] 2.1 Add the `v` version discriminator and the discriminated `kdf` parameter block to `KeyRecord` in `src/domain/types.ts`, with the `argon2id` and `pbkdf2-sha256` variants.
- [ ] 2.2 Add the `VaultEnvelope` type (`v`, `kdf`, `verifier`, `createdAt`, `updatedAt`) and the `wrappedDek` field on `KeyRecord`, keeping `ct` and `iv` and keeping legacy `salt` optional.
- [ ] 2.3 Change `CryptoKdf.deriveKey` in `src/application/ports/crypto.ts` from `(password, salt)` to a parameter-object signature that carries either algorithm's cost fields.
- [ ] 2.4 Add an `aad: Uint8Array` argument to `CryptoAead.encrypt` and `CryptoAead.decrypt` in the same port file.
- [ ] 2.5 Define the version and parameter floor constants (accepted `v` values, minimum Argon2id `m`/`t`, minimum PBKDF2 iterations) in one place in the domain layer.

## 3. AAD Encoder

- [ ] 3.1 Add a fixed-field, explicitly ordered AAD encoder in the domain layer with the three domain-separated shapes (`ostrilo/vault-verifier`, `ostrilo/vault-dek`, `ostrilo/vault-sk`).
- [ ] 3.2 Add unit tests asserting byte-stable output for identical inputs and different output for every single-field change, including each `kdf` cost field.
- [ ] 3.3 Add a unit test asserting the encoder does not include `label`, `isSelected`, `createdAt`, or `lastUsedAt`.

## 4. Crypto Adapters

- [ ] 4.1 Thread the `aad` argument through `WebCryptoAesGcm.encrypt` and `decrypt` in `src/infrastructure/crypto/adapters.ts`.
- [ ] 4.2 Add an `Argon2idKdf` adapter over `argon2idAsync` with `asyncTick` set so derivation yields to the event loop.
- [ ] 4.3 Add a `WebCryptoPbkdf2` adapter using `crypto.subtle.deriveBits`, replacing the pure-JS `NoblePbkdf2` for new material.
- [ ] 4.4 Keep a legacy-read-only PBKDF2-100k derivation path available for unversioned records and mark it as read-only in code.
- [ ] 4.5 Add adapter unit tests in `tests/unit/infrastructure/adapters.test.ts` for AAD round-trip, AAD mismatch rejection, and recorded-parameter derivation.

## 5. Envelope Write Path

- [ ] 5.1 Add envelope creation to `KeyVaultService`: derive the KEK from fresh parameters, write the `verifier`, and persist `vaultEnvelope` when the first key is created or imported.
- [ ] 5.2 Rewrite `encryptPrivateKey` to generate a fresh 32-byte DEK per key, encrypt the private key under the DEK with the `vault-sk` AAD, and wrap the DEK under the KEK with the `vault-dek` AAD.
- [ ] 5.3 Update `generateKey` and `importKey` to write `v: 1` records and to derive the KEK at most once per operation.
- [ ] 5.4 Delete `validatePasswordAgainstExistingKeys` and route its callers through the envelope `verifier` check.
- [ ] 5.5 Zeroize the KEK and every DEK in `finally` blocks on all write paths.

## 6. Envelope Read Path

- [ ] 6.1 Rewrite `unlock` to load the envelope, reject unknown `v`, reject below-floor parameters, derive the KEK once, and decrypt the `verifier` before any per-record work.
- [ ] 6.2 Replace the `Promise.all` record loop with per-record try/catch so one failure cannot reject the whole unlock.
- [ ] 6.3 Verify each decrypted key against `record.pubkey` via the `Schnorr` port, and zeroize and reject on mismatch.
- [ ] 6.4 Change the `unlock` return shape to `{ selectedKeyId?, unlockedKeyIds, damagedKeyIds }` and write `isLocked: false` only after the `verifier` succeeds.
- [ ] 6.5 Reject an unlock attempt when no envelope and no records exist, with a `vault_not_created` outcome.
- [ ] 6.6 Update `revealKey` to use the envelope, and to verify the recovered key against the stored pubkey before returning any material.

## 7. Legacy Read And Lazy Migration

- [ ] 7.1 Add per-record dispatch on `v` so unversioned and `v: 1` records coexist in one vault.
- [ ] 7.2 Add the legacy unlock path: PBKDF2-100k, no AAD, and `incorrect_password` only when every legacy record fails to decrypt.
- [ ] 7.3 Create the envelope from fresh parameters after the password is proven against a legacy record.
- [ ] 7.4 Implement write-verify-then-delete: write `v: 1` material alongside the legacy `salt`, read it back, verify against `pubkey`, and only then remove the legacy `salt`.
- [ ] 7.5 On any migration failure, leave the legacy record untouched, keep the key usable for the session, and mark the record as still legacy.
- [ ] 7.6 Build a fixture vault with the pre-change code (one legacy record, two legacy records, one mixed vault) and add migration tests against each.
- [ ] 7.7 Add a test that interrupts migration between the new-material write and the legacy-field delete and asserts the record still unlocks.

## 8. Error Codes And Unlock UX

- [ ] 8.1 Add `unsupported_vault_version`, `vault_parameters_downgraded`, `vault_record_damaged`, and `vault_not_created` to `src/infrastructure/messaging/error-codes.ts`.
- [ ] 8.2 Map the new outcomes in `handleUnlock` in `src/infrastructure/messaging/handlers/vault-rpc.ts` so a damaged record is never returned as an incorrect password.
- [ ] 8.3 Add a pending state to `LockScreen` that disables resubmission while a derivation is in flight.
- [ ] 8.4 Add honest error copy for each new code, and stop the "Incorrect password" fallback from swallowing them.
- [ ] 8.5 Surface `damagedKeyIds` to the UI so a partially damaged vault reports which key is affected.

## 9. Composition And Second Implementation

- [ ] 9.1 Update `src/extension/background.ts` to inject the chosen KDF adapter into `KeyVaultService` in place of `NoblePbkdf2`.
- [ ] 9.2 Restrict or remove the write side of `deriveKeyFromPassword`, `encryptPrivateKey`, and `decryptPrivateKey` in `src/domain/utils/crypto.ts` so no code path can silently write legacy material.
- [ ] 9.3 Correct the false "browser compatibility" comment at `src/domain/utils/crypto.ts:176` and the NS-N-001 header claim at line 6.

## 10. Security Tests

- [ ] 10.1 Add tests asserting a new record carries `v` and the full `kdf` parameter block, and that the read path uses recorded parameters over code defaults.
- [ ] 10.2 Add tests asserting an unknown `v` and below-floor parameters are refused without decryption, deletion, or rewrite.
- [ ] 10.3 Add tamper tests for each bound AAD field: swapped `ct` between records, rewritten `kdf` parameters, rewritten `pubkey`, rewritten `id`, and a `verifier` blob replayed into the `wrappedDek` slot.
- [ ] 10.4 Add a test asserting a decrypted key that does not derive its stored `pubkey` is rejected and zeroized.
- [ ] 10.5 Add a test asserting one damaged record still lets the other keys unlock and does not report an incorrect password.
- [ ] 10.6 Add tests asserting an empty vault rejects a wrong password, accepts the correct one, and that a vault with no envelope reports `vault_not_created`.
- [ ] 10.7 Add a test asserting exactly one KDF invocation per unlock with a five-key vault.
- [ ] 10.8 Extend `tests/security/memory-zeroization.test.ts` to cover the KEK, every DEK, and rejected plaintext.
- [ ] 10.9 Update `tests/security/crypto-security.test.ts` and `tests/unit/application/keyvault.service.test.ts`, both of which build or inspect the raw record shape directly.

## 11. Documentation

- [ ] 11.1 Update NS-N-001 in `docs/ostrilo-signer-requirements.md` to name the shipped algorithm and its recorded parameters.
- [ ] 11.2 Update SEC-015 status in `docs/v2-prd.md` to reflect the shipped state.
- [ ] 11.3 Document the `v: 1` storage layout and the AAD field list where developers will find it, and record that the `v: 1` read path is retained permanently.

## 12. Verification

- [ ] 12.1 Run `openspec validate harden-vault-key-derivation --strict`.
- [ ] 12.2 Run `pnpm run compile`.
- [ ] 12.3 Run `pnpm run test:unit -- tests/unit/application/keyvault.service.test.ts tests/unit/infrastructure/adapters.test.ts`.
- [ ] 12.4 Run `pnpm run test:security`.
- [ ] 12.5 Run `pnpm run test:integration`.
- [ ] 12.6 Run `pnpm run test:e2e` for the onboarding create/import and unlock flows, confirming the unlock pending state does not break the fixtures.
- [ ] 12.7 Run `pnpm run build` and `pnpm run build:firefox`.
- [ ] 12.8 Confirm the measured unlock derivation still meets the sub-1-second budget in the built Chrome MV3 and Firefox MV2 extensions.
- [ ] 12.9 Skip `npx react-doctor@latest` for now: pnpm blocks the install with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`, so run it only once React Doctor is pinned locally, which belongs to the separate `restore-security-test-assurance` change.

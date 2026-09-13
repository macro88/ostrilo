## 1. Sequencing Preconditions

- [ ] 1.1 Confirm `restore-security-test-assurance` has landed the vendored BIP-340 and NIP-01 known-answer vectors, and record where the vector files and loader live.
- [ ] 1.2 Confirm `harden-vault-key-derivation` has landed, and record the final shapes of `CryptoKdf.deriveKey` and `CryptoAead.encrypt`/`decrypt` so this change consolidates around the current ports and not the pre-change ones.
- [ ] 1.3 Re-run the Decision 2 deletion table against the post-KDF tree and confirm every listed symbol still has no caller in `src/`, correcting any line numbers the companion changes moved.
- [ ] 1.4 Confirm whether `remove-key-exfiltration-surface` has changed the `crypto.parsePrivateKey` response, and note whether the surviving parser must serve one caller or two.

## 2. Baseline Capture

- [ ] 2.1 Record known-answer output from the current implementations for a fixed set of events and keys: event ids, signatures, npub and nsec encodings, and encrypted-record round trips. This is the before-image the refactor must reproduce byte for byte.
- [ ] 2.2 Run `pnpm run test` on the unmodified tree and record the passing baseline, so any later failure is attributable to this change.

## 3. Ports And Adapters

- [ ] 3.1 Add `CryptoHash` with `sha256(data: Uint8Array): Uint8Array` to `src/application/ports/crypto.ts`.
- [ ] 3.2 Add `Bech32Codec` with `encode(prefix, bytes)` and `decode(encoded)` to `src/application/ports/crypto.ts`, fixing a single length limit rather than carrying the current disagreement between `encoding.ts:14` and `crypto.ts:484`.
- [ ] 3.3 Add `verify(signature, hash32, publicKey)` to the `Schnorr` port.
- [ ] 3.4 Implement `NobleSha256` and `ScureBech32` in `src/infrastructure/crypto/adapters.ts`, and add `verify` to `NobleSchnorr`.
- [ ] 3.5 Inject the two new adapters into `KeyVaultService` at the `src/extension/background.ts` composition root.
- [ ] 3.6 Add unit tests for the two new adapters covering round trips, prefix mismatch, and malformed bech32 input.

## 4. Pure Domain Modules

- [ ] 4.1 Create `src/domain/utils/hex.ts` with `bytesToHex`, `hexToBytes`, `isValidHex` and `assertHexBytes(input, byteLength)`, importing nothing.
- [ ] 4.2 Make `hexToBytes` reject odd length, reject any non-hex character, and never substitute a zero byte or return a partial result.
- [ ] 4.3 Create `src/domain/nostr/event-serialization.ts` with `serializeEventForId(pubkey, created_at, kind, tags, content): string`, which returns the NIP-01 pre-image and performs no hashing, encoding or signing.
- [ ] 4.4 Move `zeroize` from `src/domain/utils/crypto.ts:40` to `src/domain/utils/memory.ts` with its behaviour unchanged.
- [ ] 4.5 Reduce `src/domain/crypto/interfaces.ts` to a constants module exporting only `CRYPTO_CONSTANTS`, and update the two importers at `src/domain/utils/encoding.ts:7` and `src/domain/utils/validation.ts:6`.
- [ ] 4.6 Add unit tests for the hex codec covering the 64-character all-`z` input that currently returns 32 zero bytes, odd length, partially malformed input, mixed-case round trips, and lowercase-only encoding output.
- [ ] 4.7 Add unit tests for the serializer proving it is callable with no adapter, port or mock, and asserting its output against the vendored NIP-01 vectors including the control-character, `U+2028`, `U+2029` and `U+007F` cases.

## 5. Single Private-Key Parser

- [ ] 5.1 Create `src/application/crypto/private-key.ts` exporting `parsePrivateKey(bech32: Bech32Codec, input: string)`, built from the already-live `KeyVaultService.parsePrivateKey` at `src/application/services/key-vault.service.ts:53` and using the shared hex codec.
- [ ] 5.2 Point `KeyVaultService.importKey` at the shared parser and delete the private `parsePrivateKey` method.
- [ ] 5.3 Point the dynamic import at `src/infrastructure/messaging/handlers/crypto-rpc.ts:62` at the shared parser.
- [ ] 5.4 Verify both paths produce identical results and identical error behaviour for hex, `0x`-prefixed hex, `nsec`, wrong-prefix bech32, wrong-length bech32 and malformed input.
- [ ] 5.5 Delete `parsePrivateKey` from `src/domain/utils/encoding.ts:43`.

## 6. Single Event ID And Signing Path

- [ ] 6.1 Create `src/application/crypto/event-id.ts` exporting `computeEventId(hash: CryptoHash, event)`, composing `serializeEventForId`, `hash.sha256` and `bytesToHex`.
- [ ] 6.2 Point `KeyVaultService.signEvent` at the shared `computeEventId`.
- [ ] 6.3 Point both `NostrRpcHandler` call sites at the shared `computeEventId` — `src/infrastructure/messaging/handlers/nostr-rpc.ts:207` and `:275`.
- [ ] 6.4 Change `KeyVaultService.signEvent` to sign via `this.sign(eventId)` so the class has one Schnorr call site through the injected port instead of two.
- [ ] 6.5 Validate `hashHex` as 64-character hex in `KeyVaultService.sign` before decoding, replacing the unguarded `match(/.{1,2}/g)` decode at `src/application/services/key-vault.service.ts:396`.
- [ ] 6.6 Replace the private `toHex` at `src/application/services/key-vault.service.ts:47` and the inline hex encode at `:402` with the shared codec.
- [ ] 6.7 Replace the inline `bech32` calls in `exportKey` (`:461-462`) and `revealKey` (`:506-507`) with the `Bech32Codec` port, and remove the direct `@scure/base` import at `:9`.
- [ ] 6.8 Replace the direct `@noble/hashes/utils.js` `randomBytes` import at `src/application/services/key-vault.service.ts:8` so the application layer holds no crypto-library import.
- [ ] 6.9 Assert the event ids and signatures produced after tasks 6.1 to 6.8 are byte-identical to the task 2.1 baseline.

## 7. Unpaired Surrogate Rejection

- [ ] 7.1 Add a well-formed-string refinement to `content` and to every `tags` entry in `UnsignedEventSchema` at `src/infrastructure/validation/schemas.ts:140-146`.
- [ ] 7.2 Confirm the rejection returns the existing `RPC_ERROR_CODES.INVALID_EVENT` and adds no new error code.
- [ ] 7.3 Confirm a rejected event computes no id and opens no approval prompt.
- [ ] 7.4 Add tests covering an unpaired surrogate in `content`, an unpaired surrogate in a tag value, and a correctly paired surrogate pair such as an emoji that must still be accepted.
- [ ] 7.5 Record in the code that `JSON.stringify` remains the serializer by decision, with the reasoning from Decision 5, so a later author does not read it as an oversight.

## 8. UI Boundary

- [ ] 8.1 Add the additive `npub` field to the key-list response projection, encoded in the background through `ScureBech32`.
- [ ] 8.2 Supply the encoded npub for the selected key so `src/ui/features/profile/components/ProfileView.tsx:37` no longer calls `hexToNpub`.
- [ ] 8.3 Remove the `hexToBytes` and `publicKeyToBech32` calls at `src/ui/state/KeyManagerContext.tsx:112` and `:136` and consume the supplied value.
- [ ] 8.4 Give the key list a readable error state for a record whose stored `pubkey` is not valid hex, so a malformed record surfaces as an error rather than an npub derived from zero bytes or an unhandled render exception.
- [ ] 8.5 Confirm the replacement for `hexToNpub` validates its input and propagates failure, dropping the current swallow-and-return-hex fallback at `src/domain/utils/crypto.ts:485-488`.
- [ ] 8.6 Confirm no module under `src/ui/` imports `@noble/*` or `@scure/*`.
- [ ] 8.7 Keep the key list and profile surfaces aligned with `docs/design/DESIGN_RULES.md`.

## 9. Deletions

- [ ] 9.1 Remove the unused `signEventHash` and `publicKeyToHex` imports at `src/infrastructure/messaging/handlers/nostr-rpc.ts:16-17`.
- [ ] 9.2 Delete the dead key-material functions from `src/domain/utils/crypto.ts`: `generatePrivateKey`, `getPublicKey`, `generateKeyPair`, `privateKeyToBech32`, `publicKeyToBech32`, `publicKeyToHex`.
- [ ] 9.3 Delete the dead parsing functions from `src/domain/utils/crypto.ts`: `parsePrivateKeyFromBech32`, `parsePrivateKeyFromHex`, `parsePrivateKey`.
- [ ] 9.4 Delete the dead KDF and AEAD functions from `src/domain/utils/crypto.ts`: `deriveKeyFromPassword`, `encryptPrivateKey`, `decryptPrivateKey`.
- [ ] 9.5 Delete the dead signing, hashing and WebAuthn functions from `src/domain/utils/crypto.ts`: `signHash`, `createHash`, `verifySignature`, `verifyEventSignature`, `isWebAuthnAvailable`, `isPlatformAuthenticatorAvailable`.
- [ ] 9.6 Delete `computeEventId`, `signEventHash` and `hexToNpub` from `src/domain/utils/crypto.ts` once tasks 6 and 8 have moved their callers, and delete the now-empty module along with its `EncryptedKey` and `KeyPair` types.
- [ ] 9.7 Delete `bytesToBech32`, `bech32ToBytes`, `privateKeyToBech32`, `isValidBech32`, `hexToBytes`, `bytesToHex`, `isValidHex` and `publicKeyToBech32` from `src/domain/utils/encoding.ts` once their replacements are in place, and delete the module if nothing remains.
- [ ] 9.8 Confirm every deprecated `String.prototype.substr` call in the crypto modules is gone — `src/domain/utils/crypto.ts:151`, `:427`, `:456`, `:461`, `:466` and `src/domain/utils/encoding.ts:74`.
- [ ] 9.9 Confirm no module in `src/` imports `@noble/*` or `@scure/*` outside `src/infrastructure/crypto/`.

## 10. Test Migration

- [ ] 10.1 Re-point `tests/unit/domain/nostr-events.test.ts` at the surviving implementations: the application-layer `computeEventId`, `KeyVaultService` signing, and the `Schnorr` adapter for public-key derivation and verification.
- [ ] 10.2 Re-point the crypto imports in `tests/unit/domain/utils.test.ts` at `src/domain/utils/memory.ts` and at `KeyVaultService.generateKey` for key generation.
- [ ] 10.3 Collapse `tests/unit/domain/utils.test.ts` and `tests/unit/domain/domain-utils.test.ts` into one file, keeping the assertions that differ between the two and dropping the redundant copy.
- [ ] 10.4 Replace `expect(() => hexToBytes("invalid")).toThrow()`, which passes only on the odd-length branch, with assertions that separately cover odd length and even-length non-hex input.
- [ ] 10.5 Resolve `tests/test-crypto.ts` — delete it if `restore-security-test-assurance` has not already, since Vitest never collects it and nothing imports it.
- [ ] 10.6 Update `tests/security/memory-zeroization.test.ts`, `tests/unit/infrastructure/rpc-handlers.test.ts` and `tests/unit/infrastructure/rpc-validation.test.ts` for the relocated `zeroize` and the relocated parser, keeping their mock targets pointing at modules that still exist.
- [ ] 10.7 Run the vendored BIP-340 and NIP-01 vectors against the consolidated implementations and confirm every expected id and signature matches and every invalid vector is rejected.
- [ ] 10.8 Add a test proving a vault written before this change still unlocks after it.

## 11. Enforcement

- [ ] 11.1 Add ESLint with a flat config and TypeScript parsing, scoped to the single rule this change needs rather than a full style-lint rollout.
- [ ] 11.2 Add a `no-restricted-imports` rule with `@noble/*` and `@scure/*` patterns applied to `src/**`, with an override lifting the restriction for `src/infrastructure/crypto/**`, and a message naming `src/application/ports/crypto.ts` as the alternative.
- [ ] 11.3 Add a lint script to `package.json` and confirm the rule fails on a deliberately added `@noble/hashes` import in a domain module.
- [ ] 11.4 Add the single-implementation test that walks `src/` and asserts exactly one implementing module per primitive, detecting by import edge rather than by function-name string match.
- [ ] 11.5 Make the assertion message name the primitive and every file implementing it, and confirm the test fails when a second implementation is added inside the adapter layer where lint would permit the import.
- [ ] 11.6 Register the lint step and the single-implementation test in the CI workflow that `restore-security-test-assurance` added.

## 12. Documentation

- [ ] 12.1 Correct the `src/domain/utils/crypto.ts` header comment referencing NS-N-001, NS-N-002 and NS-N-003 if any part of that module survives, or remove it with the file.
- [ ] 12.2 Document the crypto layer boundary in `docs/development-standards.md`: primitives live in `src/infrastructure/crypto/`, are reached through `src/application/ports/crypto.ts`, and the lint rule enforces it.
- [ ] 12.3 Note the surviving module layout in `docs/architecture_primer.md` where it describes the crypto adapters, so the primer matches the tree.
- [ ] 12.4 Update `docs/v2-prd.md` status notes only if this change moves a tracked row.

## 13. Verification

- [ ] 13.1 Run `openspec validate consolidate-crypto-implementations --strict`.
- [ ] 13.2 Run `pnpm run compile`.
- [ ] 13.3 Run `pnpm run test` in full, not a focused subset, because this is a cross-cutting refactor and the tests most likely to break are the ones nobody would think to run.
- [ ] 13.4 Run the new lint script and confirm it reports no restricted crypto import.
- [ ] 13.5 Run a `knip` or per-symbol grep pass against the Decision 2 table and confirm every deleted export is gone with no dead export remaining in the crypto modules.
- [ ] 13.6 Run the single-implementation assertion test and confirm it passes on the consolidated tree.
- [ ] 13.7 Confirm the recorded event ids, signatures and encodings match the task 2.1 baseline byte for byte.
- [ ] 13.8 Run `pnpm run build`.
- [ ] 13.9 Run `pnpm run build:firefox`.
- [ ] 13.10 Run relevant Playwright extension tests for onboarding key import, NIP-07 signing and the approval flow, since key parsing, event ids and signing all moved.
- [ ] 13.11 Defer `npx react-doctor@latest` until React Doctor is pinned locally by `restore-security-test-assurance`. It currently cannot install: pnpm blocks it with `ERR_PNPM_TRUST_DOWNGRADE` for `semver@6.3.1` under `react-doctor@0.9.13`, so the command produces no findings. Once pinned, run the local binary and keep fixing findings until it reports `No issues found!` and `100 / 100`.

## 1. Bind the page origin to the attested sender

- [ ] 1.1 Add `attestPageOrigin(sender, runtimeId, claimedOrigin)` beside `isTrustedExtensionSender` in `src/infrastructure/messaging/rpc-router.ts`. It returns the derived origin or a refusal, and applies each rule in design Decision 1: runtime id, tab present, `frameId === 0`, `https:` URL, `sender.origin` agreement where present, equality with the claim.
- [ ] 1.2 Unit-test `attestPageOrigin` for every rule, with Chromium-shaped (`origin` present) and Firefox-shaped (`origin` absent) senders.
- [ ] 1.3 In `createRpcMessageListener`, run the attestation for the `nostr` namespace before the lock gate. Refuse with `invalid_origin` and no service call, and overwrite `message.origin` with the derived origin on success.
- [ ] 1.4 Add `tests/security/page-origin-binding.test.ts`: a claimed origin that disagrees with the sender changes no consent, trust, rate-limit or activity state for either origin. Cover `getPublicKey`, `signEvent` and `cancelRequest`.
- [ ] 1.5 Add an e2e case to `tests/e2e/nip07-provider.spec.ts` in which a page calls `history.pushState` and then `signEvent`, and the approval window shows the page's origin.

## 2. Narrow `policy.setOrigin`

- [ ] 2.1 Remove `rules`, `sessionGrantAll` and `updatedAt` from `OriginPolicyPatchSchema` in `src/infrastructure/validation/schemas.ts`.
- [ ] 2.2 Add `patchGrantsAuthority(patch)` next to `patchNeedsReauth` in `src/infrastructure/messaging/reauth.ts`. It is true for `trustLevel: "high"` or `identityDisclosure: "allow"`. Use it in `handleSetOrigin` in place of the inline `trustLevel` check.
- [ ] 2.3 Update the JSDoc of `policySetOrigin` in `src/infrastructure/messaging/client.ts`, and the comment in `useAppSettings.updateOriginPolicy`, to name both password-requiring values.
- [ ] 2.4 Extend `tests/security/reauth-boundary.test.ts`. `rules` and `sessionGrantAll` patches are refused with `invalid_params` and store nothing. `identityDisclosure: "allow"` without a password is refused and with it succeeds. `ask` and `deny` need no password.
- [ ] 2.5 Add the enumeration test from the `consent-scope-integrity` delta: every key of `OriginPolicyPatchSchema.shape` is classified as authority-granting or not, and an unclassified key fails.
- [ ] 2.6 Update the existing `setOrigin` cases in `tests/unit/infrastructure/policy-rpc-handler.test.ts`, `rpc-validation.test.ts` and `rpc-handlers.test.ts` that send removed fields.
- [ ] 2.7 Confirm `docs/design-review/capture-screenshots.mjs` still seeds its populated state. It sends `identityDisclosure: "allow"` with the password already, and must keep doing so.

## 3. One throttle for every password check

- [ ] 3.1 Add a `withPasswordThrottle(context, method, fn)` helper. It checks before `fn`, records a failure on `incorrect_password`, records success when `fn` resolves, and returns `rate_limited` with the remaining wait.
- [ ] 3.2 Route `handleUnlock` through the helper with no behaviour change, and keep `tests/security/unlock-throttle.test.ts` passing unmodified.
- [ ] 3.3 Route `requireReauth`, `handleReveal`, and `handleGenerate` / `handleImport` when a vault exists through the helper. Leave first-vault creation uncharged.
- [ ] 3.4 Extend `tests/security/unlock-throttle.test.ts` with each `unlock-throttling` delta scenario: re-auth refused during backoff, reveal failures locking out unlock, import throttled, first vault uncharged, and re-auth success resetting the count.
- [ ] 3.5 Make `ReauthDialog` / `useReauth` render `rate_limited` as a wait with its remaining time rather than as an incorrect password, reusing the lock screen's presentation.

## 4. Vault lifecycle fixes

- [ ] 4.1 Zeroize every held key before `this.unlocked.clear()` in `KeyVaultService.unlock()`.
- [ ] 4.2 Add a re-unlock case to `tests/security/memory-zeroization.test.ts`. It retains the first unlock's key buffer and asserts every byte reads zero after the second unlock.
- [ ] 4.3 Restructure `KeyVaultService.lock()` as design Decision 5 describes: the unconditional steps first, the settings write and broadcast in `try`, the listeners in `finally`, and the error rethrown afterwards.
- [ ] 4.4 Add a test in which `storage.sync.set` throws during `lock()`. It asserts that pending approvals are denied, the badge listener ran, the lock state reads locked, and the error reached the caller.

## 5. KDF ceilings

- [ ] 5.1 Measure Argon2id at `m = 262144 KiB` in the Chrome and Firefox service workers. Record the result in the change folder and adjust the ceiling if it breaks the `vault-key-derivation` responsiveness budget.
- [ ] 5.2 Add `KDF_CEILINGS` to `src/domain/types.ts` and check it in `KeyVaultService.assertKdfAcceptable`, refusing with `kdf_above_ceiling`.
- [ ] 5.3 Check `KDF_CEILINGS` in `deserializeKdf` in `key-backup-envelope.ts`, refusing with `BACKUP_DECRYPT_FAILURE_MESSAGE`.
- [ ] 5.4 Add tests showing that an over-ceiling envelope, and an over-ceiling backup file, are refused without calling the KDF adapter (assert on a spy), and that `KDF_DEFAULTS` sits within the bounds.

## 6. Approval-window command sender

- [ ] 6.1 Apply `isTrustedExtensionSender` to the `ostrilo.openApprovalWindow` listener in `src/extension/background.ts`.
- [ ] 6.2 Add a case to `tests/security/rpc-privilege-boundary.test.ts`: a web-page sender creates or focuses no window.

## 7. Documentation

- [ ] 7.1 Correct `docs/extension-manifest.md`. Sync storage holds `appSettings` (including origin policies) as well as `isDocked`; `alarms` is shipped; `idle` is in the permission set.
- [ ] 7.2 Document origin binding in `docs/rpc-architecture.md`, and `invalid_origin`'s new trigger in `docs/rpc-error-codes.md`.
- [ ] 7.3 Update the `docs/roadmap.md` rows and snapshot text this change affects, including SEC-019, SEC-022 and SEC-024. Check first whether the roadmap-reconciliation work has already restated them.
- [ ] 7.4 Add a `CHANGELOG.md` entry, and mark `policy.setOrigin` BREAKING for any caller that sent `rules`.

## 8. Verification

- [ ] 8.1 `pnpm run compile` and `pnpm run lint`
- [ ] 8.2 `pnpm run test:coverage`
- [ ] 8.3 `pnpm run build` and `pnpm run build:firefox`
- [ ] 8.4 Playwright: `nip07-provider`, `identity-disclosure`, `settings-origin-policy`, `security-settings`, `vault-lock` and `approval-flow` on the Chrome build
- [ ] 8.5 `pnpm run doctor` and `pnpm run slop:changes`; address findings in the changed files and report both scores
- [ ] 8.6 Dependency audit, unchanged: no dependency is added

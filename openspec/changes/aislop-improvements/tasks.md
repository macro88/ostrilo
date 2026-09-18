# Implementation tasks

Batches are ordered so each is independently verifiable and revertable.
**Security-sensitive work (group 2) lands in its own commit, before and separate from
cosmetic work (group 5)**, so a reviewer can judge the secret lifecycle without
reading import merges.

Every task states its acceptance criteria and the commands that verify it. Run
verification per batch, not only at the end. If a command cannot run, report the
exact command and the verbatim failure — a skipped check is never a pass
(`docs/development-standards.md`).

Pinned binaries only: `node_modules/.bin/aislop`, `node_modules/.bin/react-doctor`,
via `pnpm run slop:changes` / `slop:ci` / `doctor`. **Never** `npx`, `pnpm dlx`, or
`@latest`.

## 1. Confirm the baseline before changing anything

- [ ] 1.1 Re-run the baseline on the working branch and confirm it matches `proposal.md`: `pnpm run slop:ci` (expect 80/100, 290 files, 0 errors, 137 warnings, 10 suppressed, exit 0), `pnpm run compile`, `pnpm run test` (expect 83 files / 1346 tests pass). *Acceptance:* all three match, or the divergence is recorded before any edit.
- [ ] 1.2 Record the current `pnpm audit` result and dependency path for the esbuild advisory, and confirm `pnpm audit --audit-level high` still exits 0. *Acceptance:* the advisory is documented as a tracked item; no claim of a clean audit anywhere in the change.

## 2. Secret-buffer cleanup (security-sensitive — own commit)

Failing test first, in every case. A test that passes before the fix has not
reproduced the defect.

- [ ] 2.1 Add a **failing** test to `tests/security/memory-zeroization.test.ts`: `importKey` with parser-rejected input. Use the existing `fakeKdf()` seam so `derivedKeys` holds the KEK by object identity. Assert the buffer was non-zero at handoff, then all-zero after rejection, and that the rejection carries the parser's own error. *Acceptance:* the test fails, and the failure names the non-zero KEK — not a wrong-reason failure.
- [ ] 2.2 Add a **failing** test: `generateKey` when `crypto.getRandomValues` throws on the private-key draw. Gate the throw on the first 32-byte draw occurring after `derivedKeys.length >= 1`, so the KDF salt, the IVs and the DEK draw are unaffected. Assert the KEK reads zero and assert the rejection message. *Acceptance:* the test fails for the right reason; it does not fail because the salt draw threw.
- [ ] 2.3 Add a **failing** test: `kekForWrite`'s envelope-persistence path — a storage adapter whose `set` rejects for the envelope key on a vault with no envelope. Assert the KEK derived for that envelope reads zero. *Acceptance:* the test fails, demonstrating the gap found in this review (`design.md` D1, disposition #3).
- [ ] 2.4 Fix `importKey` (`key-vault.service.ts:383-384`): move `parsePrivateKey` inside the `try`, declaring `let sk: SecretBytes | null = null` before it and zeroizing under `if (sk)` in `finally`. Add no `catch`. *Acceptance:* 2.1 passes; the error message is unchanged; no other line of the method moves.
- [ ] 2.5 Fix `generateKey` (`key-vault.service.ts:334-336`): same shape, with `this.randomBytes(32)` inside the `try`. *Acceptance:* 2.2 passes; existing "zeroizes the generated private key after the call resolves" and "even when the call rejects" both still pass unchanged.
- [ ] 2.6 Fix `kekForWrite` (`key-vault.service.ts:324-326`): bring `saveEnvelope` under a `catch { zeroize(kek); throw; }`, mirroring `createEnvelope` directly above. **Do not** use an unconditional `finally` — the success path transfers KEK ownership to the caller and clearing it there would break every vault write. *Acceptance:* 2.3 passes; all existing generate/import/unlock tests pass, which is what proves the success path still hands out a live KEK.
- [ ] 2.7 Confirm the bounded secret-lifecycle review is complete: re-read `openEnvelope`, `createEnvelope`, `sealPrivateKey`, `openPrivateKey`, `unlock`, `revealKey` and the two `finally` blocks at `:1006-1008` and `:1062-1064`. *Acceptance:* each is either already correct (the finding of this review) or gets its own failing test plus fix; the conclusion is written down either way. Do not widen beyond `KeyVaultService` and its direct helpers.
- [ ] 2.8 Verify group 2: `pnpm run test` (full suite — unit, integration, security), `pnpm run compile`, **`pnpm run lint`** (required: this touches cryptographic code), `pnpm run slop:changes`, `git diff --check`. *Acceptance:* all pass. No security or functional failure is waived for any reason, including a score improvement.

## 3. Profile URL test effectiveness

- [ ] 3.1 Delete the `"should validate URL format"` test (`ProfileView.test.ts:200-234`). *Acceptance:* removed, not rewritten. The guarantees it gestured at are covered by `profile-metadata-bounds.test.ts:14-38` (predicate), `:123-138` (Zod schema), `:41-59` (validation drop behavior) and `remote-media-policy.test.tsx:251-278` (upload response guard) — verify each of those still passes and name them as the remaining coverage.
- [ ] 3.2 Add `ftp://example.com` and an unparseable bare string to the **existing** `isAllowedRemoteUrl` case list in `tests/unit/domain/profile-metadata-bounds.test.ts`. *Acceptance:* both assert `false` through the production predicate; no new file; no predicate logic reproduced in the test.
- [ ] 3.3 Add the render-boundary test for `RemoteUrlField`, using the `jsdom` harness already in `tests/unit/ui/features/profile/remote-media-policy.test.tsx`. Cover: `http://…` and `javascript:…` render the add-row control with no copy control, no open control, and the URL text absent from the output; `""` renders the same control as a legitimately empty field; an `https:` value keeps monospace text plus both controls; an open action against a rejected value opens no tab. *Acceptance:* satisfies every scenario in the `remote-media-policy` delta; asserts on rendered output, not on `isAllowedRemoteUrl` directly.
- [ ] 3.4 Remove the six tests in `ProfileView.test.ts` that assert only on literals they just assigned (loading/loaded, error-message, retry-count, save-success, force-fetch), per `design.md` D4. *Acceptance:* removed; 20 of the original 27 tests remain; the fallback-chain, cleaning/trimming and character-count tests are **retained** with the reason recorded; no test outside this file is touched.
- [ ] 3.5 Correct the `ProfileView.test.ts` header comment so it no longer presents logic-without-rendering as the codebase's established pattern. *Acceptance:* the comment states what the file actually covers; `remote-media-policy.test.tsx` is the pattern to follow for render assertions.
- [ ] 3.6 Verify group 3: `pnpm run test`, `pnpm run compile`, `pnpm run slop:changes`, `git diff --check`. Confirm `docs/TESTING.md` counts still match what the runner collects. *Acceptance:* all pass; the reduced test count is explained as removing tests that could not fail, not as reduced coverage.

## 4. Narrow suppressions for genuine false positives

Format, matching the eleven existing directives:
`// aislop-ignore-next-line <rule> -- <why it does not apply>`.

- [ ] 4.1 Suppress `ai-slop/hardcoded-id` at the five verified sites: `key-vault.service.ts:389`, `:887`, `error-codes.ts:69`, `nostr-rpc.ts:41`, `vault-rpc.ts:312`. Each reason states that the string is the internal error contract `vault-rpc` maps to `RPC_ERROR_CODES`, not a deployment identifier or credential. *Acceptance:* no string moved to an environment variable, no error contract altered, no test changed.
- [ ] 4.2 Suppress `ai-slop/hidden-fallback` at `crypto/adapters.ts:179`, stating that `false` is the verification answer for malformed input, that the `Schnorr` port is a synchronous boolean, and that every caller is a trust boundary. *Acceptance:* fail-closed rejection preserved; no logging added on untrusted relay input; relay handling does not throw.
- [ ] 4.3 Suppress `ai-slop/silent-recovery` at `injected.ts:228`, stating that the catch means another non-configurable `window.nostr` exists, that leaving it alone is correct, and that the caught value comes from the untrusted page realm and is deliberately not logged. *Acceptance:* behavior unchanged; no arbitrary thrown object logged.
- [ ] 4.4 Suppress `ai-slop/meta-comment` at exactly the four security-invariant sites: `key-vault.service.ts:576`, `:793`, `:940`, `domain/types.ts:167`. *Acceptance:* the rule stays enabled in `.aislop/config.yml`; no rationale is deleted for containing "used to" or "previously"; the other eleven sites get no directive.
- [ ] 4.5 Shorten the two incidental narrations: `OnboardingWelcome.tsx:9` (trim the select-a-card/Continue-button history to the present-tense design rule) and `content.ts:56` (drop the two restating lines, **keep** the keepInDom fingerprinting rationale). *Acceptance:* no security rationale lost; if either comment's history is worth keeping, it moves to linked documentation rather than being deleted.
- [ ] 4.6 Re-read all eleven existing suppressions against current code (the table in `design.md` D6 lists them): 2 `narrative-comment`, 4 WXT auto-import `eslint/no-undef`, 2 narrowed `console-leftover` in `client.ts`, and 3 in `docs/design-review/capture-screenshots.mjs` — the disposable screenshot password plus 2 browser-context globals. *Acceptance:* each is still accurate and left unchanged; the screenshot-password and browser-context-global exceptions are explicitly not churned. Note the scan reports 10 suppressed findings against 11 directives, so one is redundant — leave it rather than churn it.
- [ ] 4.7 Verify group 4: `pnpm run slop:ci`, `pnpm run compile`, `pnpm run test`, `git diff --check`. *Acceptance:* the suppressed count rises from 10 and the corresponding warnings leave the report; each added directive is confirmed to actually suppress its finding (a directive that suppresses nothing is misplaced — fix or remove it). Zero unsuppressed errors; no rule disabled; `.aislop/config.yml` unmodified.

## 5. Maintenance fixes (cosmetic — separate commit from group 2)

- [ ] 5.1 Merge the two imports from `@/infrastructure/messaging/client` in `useAppSettings.ts` (`:2-10` and `:20`). *Acceptance:* one import statement; `import/no-duplicates` cleared; no identifier added or removed.
- [ ] 5.2 Make `KeyManagerContext.tsx:161-164` a lazy initializer: `useState<UILockState>(() => ({ isLocked: true, lastActivity: Date.now() }))`. *Acceptance:* `Date.now()` evaluated once at mount instead of every render; mount-time timestamp semantics preserved; the effect at `:179` still overwrites `lastActivity` on load; `react/purity` cleared.
- [ ] 5.3 Remove `normalizeRelayUrls` (`background.ts:61-63`) and call `sanitizeRelayUrls` directly at `:257`. Keep the load-bearing rationale at the call site, shortened to why sanitizing matters here — an unbounded relay list means every named relay learns every managed pubkey. *Acceptance:* the `sanitizeRelayUrls` call is preserved; `RelayManager`'s second sanitize at `relay-manager.ts:42` is untouched; no relay behavior changes.
- [ ] 5.4 Correct the stale comment at `rpc-handlers.test.ts:298-302`: `CryptoRpcHandler` dynamically imports `checkPassword` from `@/domain/utils/password-policy` (`crypto-rpc.ts:48-52`), not `evaluatePasswordStrength` from `@/domain/utils/validation`. *Acceptance:* the reason the module mock was removed is preserved; the module named is the one actually imported.
- [ ] 5.5 Verify group 5: `pnpm run compile`, `pnpm run test`, `pnpm run slop:changes`, `git diff --check`. Run `pnpm run build` because `background.ts` is an extension entry point. *Acceptance:* all pass; no visual change, so no design review is triggered.

## 6. Type safety — batch A: provably unnecessary casts

- [ ] 6.1 In each of the eight handlers (`activity-rpc:30,31`, `approval-rpc:57,58`, `crypto-rpc:27,28`, `nostr-rpc:71,72`, `policy-rpc:45,46`, `settings-rpc:29,30`, `state-rpc:23,24`, `vault-rpc:82,83`), hoist `const method = message.type;` above the `switch` and use it in the `default` branch. *Acceptance:* 16 `as any` removed; `pnpm run compile` clean **per handler**. Where a switch narrows `default` to `never`, use a documented `never`-safe read instead — do not substitute another unchecked cast.
- [ ] 6.2 Verify batch A: `pnpm run compile`, `pnpm run test` (RPC handler and validation suites in particular), `pnpm run slop:changes`. *Acceptance:* every handler's `UNKNOWN_METHOD` response still reports the same `details` and `method`; per-method Zod validation untouched.

## 7. Type safety — batch B: RPC client boundary validation

- [ ] 7.1 Change `rpc()` in `client.ts` to receive `browser.runtime.sendMessage`'s result as `unknown` and validate it with a narrow `isRpcResponse` guard alongside the existing `isRpcErrorObject`; replace `(req as any)?.type` with `req.type`. *Acceptance:* the four casts at `:37,77,78,81` are gone; the discriminated ok/error contract, `RpcClientError`, the legacy-string error path, and the two narrowed `console-leftover` diagnostics all behave identically. This adds a runtime check; it removes none.
- [ ] 7.2 Verify batch B: `pnpm run compile`, `pnpm run test`, `pnpm run slop:changes`, plus an extension workflow that exercises messaging end to end — `pnpm run test:e2e:smoke`, or the loop in `docs/agent-loop.md` if the smoke spec does not cover the changed path. *Acceptance:* a real signing round-trip succeeds; malformed and error responses still surface the same standardized codes.

## 8. Type safety — batch C: storage adapter and service writes

- [ ] 8.1 Replace the four casts in `src/infrastructure/storage/adapters.ts:5,9,12,15` with a narrow typed record for area lookup and `Record<string, unknown>` for the get/set/remove payloads. *Acceptance:* `local`, `sync` and `session` all still resolve; if the polyfill's types genuinely lack `session`, keep one documented assertion naming that reason rather than casting the whole namespace.
- [ ] 8.2 Type the `LockState` writes at `key-vault.service.ts:442,647,757,769` properly and remove the `as any`. *Acceptance:* each literal satisfies `LockState` without assertion, or a genuinely missing field is found and fixed — which is the point of this batch. Auto-lock and session behavior unchanged.
- [ ] 8.3 Type the settings/rules writes at `policy.service.ts:218,219,228` and `settings.service.ts:117`. *Acceptance:* the per-origin rules record is typed without the triple cast; a remembered decision still grants exactly the decision made and never also confers a trust level.
- [ ] 8.4 Verify batch C: `pnpm run compile`, `pnpm run test` (security suites `auto-lock`, `policy-invariants`, `session-grant-lifecycle` in particular), `pnpm run slop:changes`, `pnpm run build`, `pnpm run build:firefox`. *Acceptance:* all pass; no `as any` traded for another unchecked cast; no generic abstraction introduced that weakens per-method validation.

## 9. Final verification and hand-off

- [ ] 9.1 Run the full blocking set: `pnpm run compile`, `pnpm run lint`, `pnpm run test`, `pnpm run build`, `pnpm run build:firefox`, and the dependency audit at the documented threshold (`pnpm audit --audit-level high`). *Acceptance:* all pass. These stay blocking regardless of any quality score.
- [ ] 9.2 Run `pnpm run doctor` with the pinned binary and report the score and findings. Baseline is 85/100 with 4 warnings. *Acceptance:* the score is reported, not gated on; findings in files this change touched are addressed or explained; no rule disabled to lower the count.
- [ ] 9.3 Run `pnpm run slop:changes` and `pnpm run slop:ci`. *Acceptance:* zero unsuppressed errors; the whole-project score is recorded alongside the 80 baseline; every added suppression names its rule and reason. **Leave `ci.failBelow: 70` unchanged** (`design.md` D8).
- [ ] 9.4 Run `git diff --check`. *Acceptance:* no whitespace errors.
- [ ] 9.5 Write the hand-off: standards-sensitive areas touched, every command that passed, every command that could not run with its verbatim error, and the score movement described honestly — **not** as ten points of improvement. The config's initial measured score was 75, the floor was 70, and part of the distance to 80 came from suppressing seven false-positive errors and from the audit completing rather than timing out.
- [ ] 9.6 Confirm the deferred list is still deferred and unstarted: accessibility/focus and `KeySelector` ARIA review, `PermissionsTab` load-failure state, provider/approval/service/RPC structural refactors, WXT/Vite plugin and storage generics, the esbuild advisory, and any gate change. *Acceptance:* none of these appear in the diff.
- [ ] 9.7 Capture project knowledge in the notes vault per its agreement (search for and update the existing `1-projects/ostrilo` note rather than creating a duplicate), then run `bash sync.sh` from the vault root and verify the push against `git ls-remote origin refs/heads/<branch>`. *Acceptance:* sync verified, or the failure reported with whether changes remain local or committed-but-unpushed.

## Non-goals for this change

No UI renders differently, so **no design review or screenshot capture is required**.
If any task turns out to change a rendered surface, stop and follow
`docs/design/DESIGN_RULES.md`: judge it in both themes against a **populated** vault
using `pnpm run build` plus both invocations of `docs/design-review/capture-screenshots.mjs`,
and record the findings in `docs/design-review/README.md`. A fresh-vault capture is
not acceptable evidence — it hides the row-level layout bugs that populated state
exposes.

Also out of scope: raising `failBelow`, disabling any rule, forced audit fixes,
dependency overrides, and any behavior change made to remove a warning.

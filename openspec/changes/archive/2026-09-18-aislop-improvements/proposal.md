# Targeted aislop-informed cleanup

## Why

A reviewed aislop assessment found two defects that a passing quality score did not
catch: `KeyVaultService.importKey` and `generateKey` acquire a key-encryption key and
then do sensitive work *outside* their `try/finally`, so a failure in that window
leaves the derived KEK in memory unzeroized; and
`tests/unit/ui/features/profile/ProfileView.test.ts` cannot detect an application
regression at all, because it imports no production code — only a type — and
re-implements every expression it claims to verify.

Both are real. Neither is a score problem. This change fixes them, clears a small
set of justified maintenance items, and records a reasoned disposition for the
remaining findings so the backlog stops being re-triaged from scratch on every pass.

aislop is used here as **evidence for review, not as an authority on correct
behavior**. Several of its findings describe intentional security design and are
retained deliberately. This change does not target 100/100 and does not alter
behavior to remove a warning.

## Verified baseline

Established on this branch at commit `8d9dd13`, clean tree, using the pinned local
binaries only (`node_modules/.bin/aislop` 0.16.1, `node_modules/.bin/react-doctor`
0.9.14). No `npx`, `pnpm dlx`, or `@latest` invocation was used.

| Check | Result | Exit |
| --- | --- | --- |
| `aislop scan` (whole project) | **80/100**, 290 files, 0 errors, 137 warnings, 0 fixable, **10 suppressed** via `aislop-ignore` directives | 0 |
| `pnpm run slop:ci` | 80/100, same counts; **dependency audit completed** (did not time out) | 0 |
| `pnpm run compile` | clean | 0 |
| `pnpm run test` | 83 files, 1346 tests, all passed | 0 |
| `pnpm run build` | chrome-mv3, 3.76 MB | 0 |
| `pnpm run build:firefox` | firefox-mv3, 3.76 MB | 0 |
| `pnpm run doctor` | **85/100**, 4 warnings (ModelViewer ×2, slider key, useProfileMetadata loading flag) | 0 |
| `pnpm audit` (default) | 1 advisory, **low** | 1 |
| `pnpm audit --audit-level high` (CI's threshold) | **passes** — no advisory at or above high | 0 |

Verdict mix: 80 style/policy, 62 AI-slop indicators, 1 confirmed defect;
1 high-confidence, 142 medium-confidence. Configured floor: `ci.failBelow: 70`.

The audit is **not clean** and this change does not claim it is. The single advisory
is esbuild 0.27.7 (GHSA-g7r4-m6w7-qqqr, CWE-22, arbitrary file read via the
development server on Windows, patched in >= 0.28.1). All nine dependency paths are
`dev: true` and arrive through `wxt` / `@wxt-dev/*`. It does not establish a
vulnerability in the shipped extension and it does not breach `verify.yml`'s
`--audit-level high` gate. It stays a tracked maintenance item.

## What Changes

**1. Close the secret-buffer cleanup gaps** (behavioral, security-sensitive)

Cleanup begins immediately after a secret is successfully acquired, so no failure
between acquisition and the operation body can skip zeroization. Three sites:

- `importKey` — `parsePrivateKey` runs before the `try`; malformed input throws and the KEK is never cleared.
- `generateKey` — `randomBytes(32)` runs before the `try`; an RNG failure leaves the KEK uncleared.
- `kekForWrite` — `saveEnvelope` runs between `createEnvelope` succeeding and the return; a storage failure leaks a live KEK. **This site is new in this review and was not in the assessment.**

A failing regression test lands before each fix. Successful generation and import
behavior, the cryptographic ports, validation order, and every error string are
unchanged.

**2. Replace the ineffective profile URL tests** (test effectiveness)

The `ProfileView.test.ts` URL test is deleted rather than rewritten: the production
predicate and the Zod schema boundary are **already** covered by real tests
elsewhere, so re-asserting them here would add duplication, not coverage. What is
genuinely missing is the **render-boundary rejection path**, and that is what gets
written. The rest of the file receives a per-test disposition, not a rewrite.

**3. Small, individually justified maintenance fixes**

Merge the duplicate messaging import in `useAppSettings.ts`; make
`KeyManagerContext`'s initial timestamp a lazy initializer so `Date.now()` stops
being evaluated on every render while keeping mount-time semantics; remove the
`normalizeRelayUrls` pass-through while keeping the shared sanitizer call and its
load-bearing rationale. Also correct one stale test comment that misdescribes where
`crypto-rpc` gets its password check.

**4. Narrow, reasoned suppressions for genuine false positives**

Line-specific `aislop-ignore-next-line` directives naming the rule and stating the
current invariant, for the five internal error-contract strings, the fail-closed
Schnorr `verify`, the injected-provider install catch, and the small subset of
meta-comments that directly guard a security invariant. No rule is disabled, no
threshold moved, no error contract changed.

**5. Type-safety cleanup in verifiable batches**

50 assertions (44 unsafe, 6 double) triaged into four classes. The clearly
unnecessary ones go first — chiefly 16 `(message as any).type` reads in handler
default branches. RPC client response handling moves to receive `unknown` and
validate. Framework-compatibility assertions are documented and deferred.

## Capabilities

### New Capabilities

None. This change strengthens existing guarantees; it introduces no new capability.

### Modified Capabilities

Each gains new requirements; no existing requirement's behavior is rewritten, so all
three deltas are `ADDED`.

- `key-vault` — **Secret Cleanup Begins At Acquisition**. The existing Memory Zeroization requirement says "after use" and "completes or fails", which is what let this defect look compliant. The new requirement pins the **acquisition window**: responsibility starts when the secret is acquired, cleanup must not alter the caller's error, and ownership transfer is distinguished from a leak.
- `security-test-assurance` — three requirements: cleanup is verified on failures raised *before* the operation body; tests distinguish operation-owned buffers from buffers the unlocked vault intentionally retains; tests exercise production code rather than restating it.
- `remote-media-policy` — **Render Boundary Rejects Non-Https URLs Independently Of Validation**. A non-`https:` value reaching a render path is presented as an empty field, never with copy/open affordances, and a genuinely empty field is distinguishable from a rejected one.

No delta for `ci-verification-gates`: the gate floor is deliberately left unchanged
(see `design.md`).

## Impact

**Source** — `src/application/services/key-vault.service.ts` (secret lifecycle,
suppressions); `src/ui/hooks/useAppSettings.ts`; `src/ui/state/KeyManagerContext.tsx`;
`src/extension/background.ts`; `src/infrastructure/crypto/adapters.ts`,
`src/extension/injected.ts`, `src/infrastructure/messaging/error-codes.ts`,
`src/infrastructure/messaging/handlers/{nostr,vault}-rpc.ts` (suppressions only);
eight RPC handler files, `src/infrastructure/messaging/client.ts`,
`src/infrastructure/storage/adapters.ts` (type safety).

**Tests** — `tests/security/memory-zeroization.test.ts` (new failing-first cases);
`tests/unit/domain/profile-metadata-bounds.test.ts` (contract cases);
`tests/unit/ui/features/profile/` (new render-boundary test, `ProfileView.test.ts`
dispositions); `tests/unit/infrastructure/rpc-handlers.test.ts` (stale comment).

**Not affected** — no dependency changes, no manifest or permission changes, no RPC
error codes or wire contracts, no `.aislop/config.yml` change, no UI visual change.
Because nothing renders differently, no design review or screenshot capture is
required; task 2's new test is a non-visual assertion about an existing component.

**Deferred** — see `design.md` for the full disposition table and the evidence-based
recommendation that the gate floor stay at 70 for now.

## Context

`proposal.md` records the verified baseline. This document records the technical
decisions, the evidence behind each disposition, and the gate analysis.

Three constraints shape every decision here:

- **`docs/development-standards.md`** — cryptographic primitives stay in `src/infrastructure/crypto/`, reached only through the ports in `src/application/ports/crypto.ts`; dependencies point inward; untrusted input is validated at the boundary; standardized RPC error codes only.
- **`AGENTS.md`** — a finding that genuinely does not apply is suppressed on its own line naming the rule and the reason; anything wider is a change to the gate, not to the code. The floor is a ratchet, not a target.
- **Failing test first.** The secret-lifecycle defect was found by static control-flow inspection, not by an executed reproduction. Until a test fails for the right reason, the defect is a reading of the code, not a demonstrated one.

### Current control flow, verified at `8d9dd13`

`key-vault.service.ts` derives a KEK through `kekForWrite`, whose docstring already
says *"Callers MUST zeroize the returned KEK."* Three call sites take ownership and
then do fallible work before establishing cleanup:

```
generateKey (:334)   kek = await kekForWrite(password)     <-- ownership acquired
            (:335)   sk  = this.randomBytes(32)            <-- can throw; kek leaks
            (:336)   try { ... } finally { zeroize(sk); zeroize(kek) }

importKey   (:383)   kek = await kekForWrite(password)     <-- ownership acquired
            (:384)   sk  = parsePrivateKey(bech32, input)  <-- throws on malformed; kek leaks
            (:385)   try { ... } finally { zeroize(sk); zeroize(kek) }

kekForWrite (:324)   { envelope, kek } = await createEnvelope(password)
            (:325)   await this.saveEnvelope(envelope)     <-- can throw; kek leaks
            (:326)   return { kek, ... }
```

`parsePrivateKey` does throw on malformed input (`invalid_nsec_prefix` and siblings
in `src/application/crypto/private-key.ts`). The neighbouring helpers are already
correct and are the model for the fix: `openEnvelope` zeroizes in its `catch` and
hands ownership out only on success; `createEnvelope` does the same; `sealPrivateKey`
and `openPrivateKey` own their DEK across a `finally`; `unlock` uses
`let kek: SecretBytes | null = null; try { ... } finally { if (kek) zeroize(kek) }`
and marks handoff explicitly with `sk = null; // ownership transferred to this.unlocked`.

So the fix is not a new pattern — it is applying this file's existing idiom to three
sites that skipped it.

## Goals / Non-Goals

**Goals**

- No failure between successful secret acquisition and the end of an operation can skip zeroization, at the three identified sites.
- Every new test observes a real buffer's contents and fails if the protection is removed.
- Each retained warning has a written reason, so the backlog is triaged once.
- Cosmetic edits stay in separate commits from security-sensitive edits.

**Non-Goals**

- Any move toward a target score. The floor stays at 70.
- Any claim about erasing JavaScript strings or `CryptoKey` internals.
- Accessibility/focus redesign, `PermissionsTab` failure state, large structural refactors, dependency upgrades. All deferred; see the disposition table.

## Decisions

### D1 — Cleanup begins at acquisition, using this file's existing idiom

Declare the secret as `let … | null = null` before the `try`, assign inside it, and
zeroize in `finally` under a null check.

```ts
const { kek, kdf } = await this.kekForWrite(password);
let sk: SecretBytes | null = null;
try {
  sk = parsePrivateKey(this.bech32, input) as SecretBytes;
  // ... unchanged body ...
} finally {
  if (sk) zeroize(sk);
  zeroize(kek);
}
```

The KEK stays outside the `try`: it is already owned at that point, and a `finally`
that unconditionally zeroizes it is correct. Only the *second* secret needs the
null-guarded form.

*Why not wrap `kekForWrite` itself in a try?* Acquisition failure is `kekForWrite`'s
own responsibility, and it already discharges it — `openEnvelope` and
`createEnvelope` zeroize on their own failure paths. Wrapping the call would add a
second owner for the same buffer.

*Why not `try/catch` with a rethrow?* A bare `finally` cannot mask the original
error. A `catch` can, by accident. The requirement is that the original error
propagates unchanged, so `finally` is the correct construct and no `catch` is added.

*`kekForWrite` itself* takes the same shape: the `saveEnvelope` call moves inside a
`try` whose `finally` zeroizes the KEK **only on the failure path**, because the
success path transfers ownership to the caller. This is the one place where an
unconditional `finally` would be wrong, so it is written as a `catch { zeroize(kek); throw; }`
mirroring `createEnvelope` directly above it.

### D2 — Tests assert on owned buffers, and say which buffers are not theirs

`tests/security/memory-zeroization.test.ts` already establishes the technique and
documents its limits honestly (lines 1–46: never mock the unit under test; retain the
byte storage, not the view; assert non-zero at handoff so an all-zero buffer cannot
trivially pass). The new cases plug into its existing `fakeKdf()` seam, which pushes
the derived KEK **object** into `derivedKeys` so test and service hold the same memory.

Two cases are genuinely new, and both fail today:

- **Malformed import.** `importKey("not-a-valid-nsec", "pw")` rejects; the retained KEK must read all-zero.
- **RNG failure.** `crypto.getRandomValues` throws on the private-key draw; `generateKey` rejects; the retained KEK must read all-zero.

The existing rejection test (`"zeroizes the generated private key even when the call
rejects"`) induces its failure in `schnorr.getPublicKey`, which is *inside* the `try`.
It passes today and will keep passing — it does not and cannot cover this window.
That is why a new test is required rather than an assertion added to the old one.

The RNG stub must throw only on the 32-byte private-key draw and only after the KEK
exists, because `randomBytes` is also the single CSPRNG entry point for the KDF salt,
the IVs, and the DEK. `DEK_LENGTH` is also 32, but the DEK is drawn inside
`sealPrivateKey`, which runs inside the `try`, so gating on "first 32-byte draw after
`derivedKeys.length >= 1`" is unambiguous.

**Owned vs retained.** Assertions target the KEK and the private-key draw, which the
operation owns. They must not assert that every retained buffer reads zero: an
unlocked vault deliberately keeps decrypted private keys in `this.unlocked`, and the
production code marks that handoff at `unlock`'s `sk = null` line. `generateKey` and
`importKey` do not unlock, so nothing is retained on these paths — the new tests state
that explicitly so a later reader does not "fix" a passing assertion into a wrong one.

**Honesty bound.** No new test claims erasure of a password string or of `CryptoKey`
internals. The suite's existing preamble already states why; the new cases inherit it.

### D3 — Delete the profile URL test; test the boundary that is actually uncovered

The instruction was to replace the test with one that exercises production behavior.
Inspecting the production contract showed that most of that coverage already exists,
so writing it again would be duplication dressed as rigor. What exists today:

| Guarantee | Covered by | Verdict |
| --- | --- | --- |
| `isAllowedRemoteUrl` accepts `https:` only; rejects `http:`, `javascript:`, `data:`, `blob:`, `file:`, `ws:`, `wss:` | `tests/unit/domain/profile-metadata-bounds.test.ts:14-24` | already real |
| rejects relative, unparseable, empty, `undefined`, non-string, over-length | same file `:26-38` | already real |
| Zod schema (`RemoteUrlSchema.refine`) rejects non-`https:` with a field-level error | same file `:123-138` | already real |
| `validateProfileMetadata` drops bad URL fields, keeps the rest, records rejections | same file `:41-59` | already real |
| `ImageUploadField` guard rejects a non-`https:` upload response | `remote-media-policy.test.tsx:251-278` | already real |
| `RemoteUrlField` **accept** path renders monospace URL + copy + open | `remote-media-policy.test.tsx:79-116` (via `ProfileSummary`) | already real |
| `RemoteUrlField` **reject** path — non-`https:` value must not get copy/open affordances | — | **gap** |
| `ftp:` and an unparseable bare string in the predicate's own case list | — | **gap** (small) |

So: **delete** `ProfileView.test.ts`'s `"should validate URL format"` test outright.
It calls `new URL()` rather than production validation, asserts `expect(true).toBe(true)`,
lists `javascript:` among "invalid URLs" and then asserts it is accepted, and makes
no assertion at all for `ftp:`. Nothing in it can fail for a correct reason, and
every guarantee it gestures at is covered above. Replacing its assertions with
different assertions against test-local logic would leave it equally unable to detect
a regression.

**Then write the one test that is missing**, in the existing `jsdom` render harness:
a `RemoteUrlField` given `http://…` or `javascript:…` renders the `ProfileAddRow`
control, exposes **no** copy or open control, and does not render the URL text —
while a field given `""` renders the same add-row for a legitimately different reason.
That distinction (empty-and-allowed vs non-empty-and-rejected) is the point: both
collapse to the same visual, and only a test pins that a rejected value is not
quietly openable. This is defense in depth behind `validateProfileMetadata`, which
is exactly why it deserves a test — a cached or legacy profile predating the
allowlist can still carry an `http:` picture.

`ftp:` and the unparseable-string case are added to the **existing** domain test's
case list, one line each, rather than seeding a new file.

*Why not recreate the predicate in the test?* Because a test that re-implements the
thing it verifies is the defect being removed, not the fix.

### D4 — `ProfileView.test.ts` as a whole: shrink, do not rewrite

All 27 tests in this file import exactly one production symbol — the *type*
`ProfileMetadata` — and no executable code. Every assertion re-evaluates an
expression the test itself wrote, so the file's true coverage is zero and its 379
lines advertise otherwise. aislop flags only three lines; the problem is structural.

The disposition is deliberately bounded, because a project-wide test rewrite is out
of scope:

- **Remove** the URL test (D3) and the six tests that assert only on literals they just assigned — `"should show loading when fetching profile"`, `"should show profile when loaded"`, `"should show error message when fetch fails"`, `"should allow retry after error"`, `"should return to display mode after successful save"`, `"should force fetch profile data bypassing cache"`. These restate assignments; none references `ProfileView`.
- **Retain for now** the fallback-chain, cleaning/trimming, and character-count tests. They mirror implementation expressions and are weak, but they encode intended *behavior* (`display_name || name || "Not set"`, drop-empty-and-trim on save) that a later change can promote into a real render test. Deleting them now would remove the specification without replacing it.
- **Do not** expand this into rendering tests for the whole profile feature. Recorded as deferred follow-up.

That leaves 20 of the original 27 tests. The count drops; the coverage does not,
because the seven removed tests could not fail.

The file header comment claims this logic-over-rendering approach "follows the
pattern established in other UI tests". `remote-media-policy.test.tsx` shows the
codebase's actual pattern is real rendering. The header is corrected so it stops
recommending the weaker approach to the next contributor.

### D5 — Maintenance fixes, each with its own reason

| Change | Reason |
| --- | --- |
| Merge `useAppSettings.ts:2-10` and `:20` into one import from `@/infrastructure/messaging/client` | The module's messaging surface — nine RPC calls — is only visible at a glance when it is one list. Two import statements from one path hide the coupling. No behavior change. |
| `KeyManagerContext.tsx:161-164` → lazy initializer `useState(() => ({ … }))` | `Date.now()` currently runs on **every** render to produce a value `useState` discards after mount. Lazy form evaluates once, at mount — identical semantics for the value that is actually used, and it clears `react/purity` because the impure call leaves the render path. The effect at `:179` still overwrites `lastActivity` on load, so the initial value only matters before that resolves; the lazy form preserves that window exactly. |
| Remove `normalizeRelayUrls` (`background.ts:61-63`), call `sanitizeRelayUrls` at `:257` | The wrapper is `return sanitizeRelayUrls(relays)` with one caller. Its docstring claims it is "kept as defence in depth" — but the defense is `sanitizeRelayUrls` itself plus `RelayManager` sanitizing again at `relay-manager.ts:42`; the wrapper contributes no check. The **rationale is load-bearing and is kept** at the call site, shortened to why sanitizing here matters: an unbounded relay list means every named relay learns every managed pubkey. |
| Correct `rpc-handlers.test.ts:298-302` | The comment states `CryptoRpcHandler` "imports `evaluatePasswordStrength` from `@/domain/utils/validation`". It does not: `crypto-rpc.ts:48-52` dynamically imports `checkPassword` from `@/domain/utils/password-policy` together with `COMMON_PASSWORDS`. The comment explains why a module mock was removed, which is worth keeping — but it currently names the wrong module, which would mislead the next person debugging a mock leak in this file. |

### D6 — Suppressions: narrow, reasoned, and not applied by the dozen

Style matches the eleven existing directives:
`// aislop-ignore-next-line <rule> -- <why it does not apply>`.

**`ai-slop/hardcoded-id` — 5 sites, all false positives.** Verified strings:
`key-vault.service.ts:389` `throw new Error("key_already_exists")`;
`:887` `throw new Error("key_locked_or_missing")`;
`error-codes.ts:69` `KEY_ALREADY_EXISTS: "key_already_exists"`;
`nostr-rpc.ts:41` `"key_locked_or_missing"` inside `VAULT_LOCKED_ERRORS`;
`vault-rpc.ts:312` `error.message === "key_already_exists"`. These are the internal
error contract that `vault-rpc` maps to `RPC_ERROR_CODES` — not deployment
identifiers and not credentials. Moving them to environment variables would break
the mapping and the error contract. Suppress in place; change nothing.

**`ai-slop/hidden-fallback` — `crypto/adapters.ts:179`.** `NobleSchnorr.verify`
catches and returns `false`. `false` *is* the answer: a malformed signature or an
off-curve point is a failed verification. The port is a synchronous boolean and every
caller is a trust boundary. Keep fail-closed rejection; add no logging (this runs on
untrusted relay input) and do not make relay handling throw. The existing comment
already states this; the suppression names the rule and points at it.

**`ai-slop/silent-recovery` — `injected.ts:228`.** The `catch` around
`Object.defineProperty(window, "nostr", …)` means another extension already defined a
non-configurable `window.nostr` between the `in` check and here. Leaving it alone is
the correct behavior — replacing it would hijack the user's chosen signer — and
throwing would throw into the page. The caught value comes from the **untrusted page
realm**, so it is deliberately not logged; a fixed warning string is emitted instead.
Suppress, preserve behavior.

**`ai-slop/meta-comment` — rule stays enabled; 15 sites, mostly false positives.**
This codebase documents *why* a security behavior is what it is by contrasting it
with the defective prior behavior, which is precisely the phrasing the rule matches.
Inspected all 15:

- **Load-bearing, retain (14).** `key-vault.service.ts:576` ("an empty vault opened with any password"), `:793` ("This FAILS CLOSED"), `:940` (single Schnorr call site, enforced by a security test), `domain/types.ts:167` (undefined upload endpoint means no outbound request), `injected.ts:67` (backstop vs authoritative deadline — not historical at all), `crypto-rpc.ts:71` (returns a verdict, never key bytes), `useExpiringClipboard.ts:3` (why a copied nsec expires in 45s), `ProfileView.tsx:36` (npub pre-encoded; `hexToNpub`'s silent fallback), `useAppSettings.ts:258` (reset patch is password-gated), `KeyManagerContext.tsx:52` and `:84`, `OnboardingCreateKey.tsx:202` and `OnboardingImportKey.tsx:265` (why `acceptable` is authoritative — `strength.score < 3` is how `"Aa1!"` was once accepted), `content.ts:56` (keepInDom fingerprinting surface).
- **Narrow exception (4).** Only for those whose comment directly prevents a security regression *and* whose deletion a future agent could plausibly justify: `key-vault.service.ts:576`, `:793`, `:940`, `domain/types.ts:167`.
- **Shorten (2).** `OnboardingWelcome.tsx:9` is genuinely incidental UI history ("There used to be a select-a-card step and a Continue button") with no invariant attached — trim to the present-tense design rule. `content.ts:56` keeps its fingerprinting rationale but loses the two restating lines above it ("Inject the window.nostr provider script into the MAIN world", "Using WXT's injectScript helper …").
- **Accept as warnings (8).** The remainder keep their comments and their warnings. Accepting a warning is a legitimate outcome at a floor of 70 and a score of 80; adding eight more suppression lines to a security-rationale comment block would be churn that makes the block harder to read, which is the opposite of the rule's intent.

**No rationale is deleted for containing "used to" or "previously."**

**Existing suppressions reviewed, none churned.** All eleven directives were re-read
against current code and remain accurate — the scan reports 10 suppressed findings, so
one directive is currently redundant, which is not worth churning either:

| Directive | Location | Verdict |
| --- | --- | --- |
| `ai-slop/narrative-comment` ×2 | `useKeyManager.ts:1`, `key-handling-documents.ts:50` | accurate, retain |
| `eslint/no-undef` ×4 (WXT auto-import) | `injected.ts:27`, `background.ts:228`, `content.ts:37`, `content.ts:62` | accurate, retain — `pnpm run compile` is the authority on undefined identifiers |
| `ai-slop/console-leftover` ×2 | `client.ts:56`, `client.ts:91` | accurate, retain — deliberate diagnostics narrowed to method/status and error code |
| `security/hardcoded-secret` ×1 | `capture-screenshots.mjs:134` | accurate, retain — disposable screenshot-runner password, never a real vault credential |
| `eslint/no-undef` ×2 (browser-context globals) | `capture-screenshots.mjs:140`, `:199` | accurate, retain — evaluated inside the page realm |

The disposable screenshot-password and browser-context-global exceptions are exactly
the ones flagged as not-to-be-churned, and they are untouched.

### D7 — Type safety: four classes, unnecessary ones first

50 assertions (44 `unsafe-type-assertion`, 6 `double-type-assertion`) triaged:

**(a) Clearly unnecessary — 16 casts, 8 files.** Every RPC handler's `default` branch
reads `details: (message as any).type, method: (message as any).type`
(`activity-rpc:30,31`, `approval-rpc:57,58`, `crypto-rpc:27,28`, `nostr-rpc:71,72`,
`policy-rpc:45,46`, `settings-rpc:29,30`, `state-rpc:23,24`, `vault-rpc:82,83`). The
parameter is the full `RpcRequest` union and each handler switches on only its own
namespace, so `message.type` is well typed. Hoisting `const method = message.type;`
above the `switch` and using it in `default` removes all 16 with no loss of
validation. **Verify per handler:** where a switch happens to be exhaustive over the
union, `message` narrows to `never` in `default` and needs a documented
`never`-safe read instead — this must be confirmed by `pnpm run compile`, not assumed.

**(b) Missing boundary validation — `client.ts:37,77,78,81`.** `rpc()` asserts
`browser.runtime.sendMessage`'s result into `RpcResponse | undefined`, then re-casts
through `(res as any).ok`. The fix is the standards' rule: receive `unknown` and
validate with a narrow `isRpcResponse` guard alongside the existing
`isRpcErrorObject`. `(req as any)?.type` becomes `req.type`. The discriminated
ok/error contract, `RpcClientError`, and the legacy-string error path are all
preserved — this adds a check, it does not relax one.

**(c) Genuine framework incompatibility — defer.** `wxt.config.ts:192` (+ its double)
is a Vite/WXT plugin type mismatch; `useWxtStorage.ts:184,195` are WXT storage
generics. Both are explicit follow-up items rather than part of this cleanup, because
resolving them means reasoning about cross-version plugin types and would dominate
the change.

**(d) Test-only fakes — `vitest.setup.ts:33`.** Narrow, documented, retained.

**(e) Service state/settings writes — bounded.** `key-vault.service.ts:442,647,757,769`
are `storage.session.set<LockState>(…, { … } as any)`; `policy.service.ts:218,219,228`
cast a rules record; `settings.service.ts:117`. These are object literals asserted
past a type mismatch, which is exactly where a real missing field hides. Batched
separately from (a) and (b) so a reviewer can judge each write against `LockState`
and `AppSettingsV1` on its own.

The six `ai-slop/ts-directive` findings are `info`, all in `vitest.setup.ts`, and are
left alone.

**No `as any` is replaced by another unchecked cast**, and no generic RPC abstraction
is introduced — per-method Zod validation stays per-method.

### D8 — Gate floor stays at 70. The evidence says a raise would not do what it looks like it does.

Measured with the pinned scanner at `8d9dd13`, and this corrected a wrong reading:

**How the two CI jobs actually score.** `.github/workflows/aislop.yml` runs
`aislop ci --changes --base origin/<branch>` on pull requests and `aislop ci` on
pushes to `main`. Both read `ci.failBelow: 70`.

A `--changes` run counts the pre-existing warnings in the touched files but
**normalizes the score over the whole project's 290-file denominator**. Measured
directly, with a one-line edit to the worst-scoring file in the repo and the result
reverted:

| Scope | Warnings counted | Score |
| --- | --- | --- |
| Whole project (`aislop ci`) | 137 | **80** |
| Files changed in `8d9dd13` (`--changes --base HEAD~1`) | 57 | **90** |
| `key-vault.service.ts` alone (`--changes --base HEAD`) | 12 | **98** |

So the per-PR gate is close to non-functional: any subset of the existing 137
warnings over 290 files scores at or above the project score, and a PR would have to
introduce dozens of new warnings to reach 70.

**A discarded misreading, recorded so it is not repeated.** Scoping with
`--include <file>` gives 56 for `key-vault.service.ts`, 51/53/73 for the three change
scopes, and 67–77 for the other touched files. Those numbers look alarming and are
**not gate evidence**: `--include` shrinks the denominator to the included files,
which neither CI job does. Reading them as gate risk would have produced the exact
wrong conclusion — that this proposal's security fix could not land.

**Therefore:**

- Raising `failBelow` to 78 would leave 2 points of headroom on the only gate that binds (whole-project, on `main`), so a single regression blocks pushes — while still not making the PR gate meaningful, since PRs score ~90–98 regardless.
- It would not block improvements to warning-heavy legacy files, because `--changes` never penalizes a file for its existing warnings relative to the project. That specific fear is unfounded; the real objection is the absent headroom.
- **Recommendation: leave `failBelow: 70` in this change.** Revisit only after the warning backlog falls, and as its own change with its own justification.

**Do not describe the current 80 as ten points of improvement.** `.aislop/config.yml`
records the score when aislop was wired in as **75** (7 errors, all since suppressed
as false positives, and 199 warnings), with the floor set to 70 — the floor was never
the measured score. 80 against 75 is **5 points**, and that 5 includes suppressing
those 7 errors and the dependency audit completing rather than timing out, not only
code fixes. This change may move the number a little; the movement is not the point
and should not be reported as one.

**Separate observation, not a task here.** The per-PR gate's scoring model means it
cannot ratchet per-PR quality as `AGENTS.md` intends. Making it meaningful needs a
changed-file denominator, which is a gate design change and belongs in its own
proposal.

## Disposition table

`fix` = code change here · `exception` = narrow suppression here · `retain` = keep as-is, warning accepted · `defer` = separate follow-up

| # | Finding | Location | Disposition | Basis |
| --- | --- | --- | --- | --- |
| 1 | KEK not zeroized when import parse throws | `key-vault.service.ts:383-384` | **fix** | Verified control flow; `parsePrivateKey` throws |
| 2 | KEK not zeroized when RNG throws | `key-vault.service.ts:334-336` | **fix** | Verified control flow |
| 3 | KEK not zeroized when `saveEnvelope` throws | `key-vault.service.ts:324-326` | **fix** | **New in this review**, not in the assessment |
| 4 | Tautological URL test | `ProfileView.test.ts:200-234` | **fix** (delete) | Guarantees already covered; see D3 |
| 5 | `RemoteUrlField` reject path untested | `RemoteUrlField.tsx:48,62,66` | **fix** (new test) | Genuine coverage gap |
| 6 | `ftp:` / unparseable absent from predicate cases | `profile-metadata-bounds.test.ts:14-38` | **fix** (2 lines) | Named in objective, absent from list |
| 7 | Six tests asserting on literals they assigned | `ProfileView.test.ts` | **fix** (remove) | Zero production imports |
| 8 | Weak-but-behavioral profile tests | `ProfileView.test.ts` | **retain** | Encodes intent; removing loses the spec. See D4 |
| 9 | Duplicate messaging import | `useAppSettings.ts:10,20` | **fix** | D5 |
| 10 | `Date.now()` on every render | `KeyManagerContext.tsx:161-164` | **fix** | D5; also clears `react/purity` |
| 11 | `normalizeRelayUrls` pass-through | `background.ts:61-63` | **fix** | D5; rationale preserved at call site |
| 12 | Stale comment naming wrong module | `rpc-handlers.test.ts:298-302` | **fix** | `crypto-rpc.ts:48-52` contradicts it |
| 13 | `hardcoded-id` ×5 | `key-vault.service.ts:389,887`, `error-codes.ts:69`, `nostr-rpc.ts:41`, `vault-rpc.ts:312` | **exception** | Internal error contract, verified strings |
| 14 | `hidden-fallback` | `crypto/adapters.ts:179` | **exception** | Fail-closed `verify`; `false` means failed |
| 15 | `silent-recovery` | `injected.ts:228` | **exception** | Untrusted page-realm throw; leaves rival provider alone |
| 16 | `meta-comment` ×4 security invariants | `key-vault.service.ts:576,793,940`, `domain/types.ts:167` | **exception** | Comment prevents a security regression |
| 17 | `meta-comment` ×2 incidental narration | `OnboardingWelcome.tsx:9`, `content.ts:56` | **fix** (shorten) | No invariant attached / restating lines |
| 18 | `meta-comment` ×8 remaining | various | **retain** | Load-bearing; 8 more directives would be churn |
| 19 | Handler `default`-branch casts ×16 | 8 handler files | **fix** | Provably unnecessary; verify with `compile` |
| 20 | RPC client response casts ×4 | `client.ts:37,77,78,81` | **fix** | Boundary validation per standards |
| 21 | Storage adapter casts ×4 | `storage/adapters.ts:5,9,12,15` | **fix** | Polyfill indexing; narrow typed record |
| 22 | Service state/settings writes ×8 | `key-vault.service.ts:442,647,757,769`, `policy.service.ts:218,219,228`, `settings.service.ts:117` | **fix** (own batch) | Literals asserted past a mismatch |
| 23 | WXT/Vite plugin + storage generics ×5 | `wxt.config.ts:192`, `useWxtStorage.ts:184,195` | **defer** | Cross-version framework types |
| 24 | Test-fake assertion | `vitest.setup.ts:33` | **retain** | Test-only, narrow, documented |
| 25 | `ts-directive` ×6 (`info`) | `vitest.setup.ts` | **retain** | Informational |
| 26 | Async loading effects | `DisclosureHistory.tsx:108`, `PermissionsTab.tsx:45` | **retain** | Legitimate synchronization, not a defect |
| 27 | Password-strength reset in effect | `password-input.tsx:150` | **retain** | Resetting to `null` on disable prevents a stale verdict leaking across the transition — the freshness guarantee its own docstring states |
| 28 | `setState` in `componentDidUpdate` | `ApprovalErrorBoundary.tsx:49` | **retain** | Guarded by `previous.resetKey !== this.props.resetKey && this.state.failed`; recovers per request without looping |
| 29 | `thin-wrapper` `evaluatePasswordStrength` | `domain/utils/validation.ts:41` | **retain** | Deliberately one-argument and blocklist-free so it cannot authorize. **Verified it has no production caller** — production uses the background's version via `messaging/client.ts:347`. Removing an export that exists to prevent a broader one is a deliberate API decision, not cleanup. Recorded, deferred |
| 30 | `duplicate-block` ×15 | various | **retain** | Chiefly generate/import record persistence. Keeping buffer ownership and `finally` blocks auditable outranks de-duplication, especially in the same files task 1 touches |
| 31 | `file-too-large` ×10, `function-too-long` ×4 | `key-vault.service.ts`, `background.ts`, `domain/types.ts`, approval views, … | **retain** / **defer** | Review prompts, not defects. A types file is not defective for being long |
| 32 | `no-autofocus` ×11, `prefer-tag-over-role` ×13 | various | **defer** | Needs a coherent keyboard/ARIA review, incl. `KeySelector`'s DropdownMenu + listbox/option mix. Findings cover profile and image fields, not only passwords |
| 33 | `PermissionsTab` maps read failure to empty grants | `PermissionsTab.tsx:39-42` | **defer** | Real gap — unavailability presented as "no grants" — but adding a failure state is a UX change deserving its own proposal |
| 34 | esbuild advisory (low, dev-only) | `package.json` | **defer** (tracked) | 9 paths, all `dev: true`, all via `wxt`. Passes `--audit-level high`. Lockfile already carries `esbuild@0.28.2` for other consumers, so a narrow resolution looks plausible — but no forced fix and no untested override |
| 35 | Gate floor | `.aislop/config.yml` | **retain** | D8 |

## Risks / Trade-offs

- **The RNG-failure test is stubbing the single CSPRNG entry point** → A stub that throws too early breaks the KDF salt draw and the test fails for the wrong reason. Gate the throw on the private-key draw occurring after the KEK exists, and assert the rejection message so a wrong-reason failure is visible.
- **`finally` could mask the original error if a `catch` creeps in** → Acceptance criteria assert the *original* error message propagates (`invalid_nsec_prefix`, the RNG error), not just that the call rejects.
- **`kekForWrite`'s success path transfers ownership** → An unconditional `finally` there would zeroize a KEK the caller is about to use, breaking every write. Written as `catch { zeroize(kek); throw; }` and covered by the existing successful generate/import tests, which would fail loudly if this were got wrong.
- **Removing handler casts could hit a `never`-narrowed `default`** → Per-handler verification by `pnpm run compile`; any handler that does narrow to `never` keeps a documented narrow read instead of a silent `as any`.
- **Deleting tests lowers the test count** → Removing seven tests that cannot fail does not reduce coverage; it stops overstating it. `docs/TESTING.md` counts are checked against the runner, per `security-test-assurance`.
- **Suppressions can rot** → Each names the rule and the current invariant, so a reviewer can tell when it stops being true. Four `meta-comment` exceptions rather than fifteen keeps that reviewable.
- **Batch ordering matters more than batch size** → Security-sensitive edits (task 1) land in their own commit, ahead of and separate from cosmetic work, so a reviewer can assess the secret lifecycle without reading import merges.

## Migration Plan

No data migration, no storage format change, no manifest change. Each task batch is
independently revertable; task 1 is a behavior-preserving fix on success paths and
changes only failure-path cleanup. Rollback is a revert of the relevant commit.

## Open Questions

- **Does any handler's `switch` narrow `default` to `never`?** Resolved by `pnpm run compile` per handler during task 5, not by inspection.
- **Is `evaluatePasswordStrength` in `domain/utils/validation.ts` wanted as a public contract with no production caller?** Needs the maintainer's intent; deferred rather than guessed (#29).
- **Can the esbuild advisory be closed narrowly?** The lockfile already resolves `esbuild@0.28.2` for some consumers, which suggests a targeted resolution may work — but it needs both builds and the full suite verified before it is proposed (#34).

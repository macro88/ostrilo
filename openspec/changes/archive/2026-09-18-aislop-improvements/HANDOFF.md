# Hand-off

## Standards-sensitive areas touched

**Cryptographic secret lifecycle** (`docs/development-standards.md`) —
`KeyVaultService.generateKey`, `importKey` and `kekForWrite`. Failure-path cleanup
only; no success path, cryptographic port, validation order or error string changed.
`pnpm run lint` was run because this is cryptographic code. Landed separately from the
cosmetic work so the secret lifecycle can be reviewed on its own.

**Trust boundary** — `rpc()` in `infrastructure/messaging/client.ts` now receives the
message-boundary result as `unknown` and validates it with `isRpcResponse` before
narrowing. This **adds** a runtime check; it removes none. The discriminated ok/error
contract, `RpcClientError`, the legacy string-error path and both narrowed diagnostics
behave identically.

**Per-method validation** — untouched. No generic RPC abstraction was introduced; Zod
validation stays per method.

## Commands run, and their results

Every command below was run to completion on the final tree.

| Command | Result |
| --- | --- |
| `pnpm run compile` | pass (also run individually after each of the 8 handlers) |
| `pnpm run lint` | pass |
| `pnpm run test` | pass — 83 files, **1349** tests |
| `pnpm run build` | pass — chrome-mv3, 3.76 MB |
| `pnpm run build:firefox` | pass — firefox-mv3, 3.76 MB |
| `pnpm run test:e2e:smoke` | pass — 1 test: creates a key and signs through NIP-07 |
| `pnpm audit --audit-level high` | exit 0 |
| `pnpm run slop:ci` | exit 0 — **86/100**, 0 errors, 87 warnings, 21 suppressed |
| `pnpm run slop:changes` | exit 0 — 0 errors |
| `pnpm run doctor` | 85/100, 4 warnings — unchanged from baseline |
| `git diff --check` | clean |

**Nothing was skipped, and nothing was waived.** No command failed to run.

Two intermediate failures were found and fixed rather than worked around:

1. Inserting an `aislop-ignore-next-line` above `KEY_ALREADY_EXISTS` broke the JSDoc
   adjacency that `error-code-coverage.test.ts` enforces. Fixed by using the
   `aislop-ignore-line` (same-line) form. **No test was changed** — the task forbids it.
2. The editor normalised line endings across two mixed-ending files, burying a 3-line
   edit in a 594-line diff. Reverted to HEAD's endings on every content-unchanged line.

## Test count

1346 → 1349. Seven tests were removed and ten added:

- **removed (7)** — `ProfileView.test.ts`: the `"should validate URL format"` test plus
  six that asserted only on literals they had just assigned. 27 → 20 tests in that file.
- **added (10)** — 3 secret-lifecycle regression tests (`memory-zeroization.test.ts`),
  7 render-boundary tests (`remote-media-policy.test.tsx`), plus 2 cases added to the
  **existing** `isAllowedRemoteUrl` case list (no new `it` block).

The removed tests imported no executable production code. **This is not reduced
coverage** — it is the removal of tests that could not fail, which is what was
overstating it.

Both new suites were confirmed able to fail:

- the 3 zeroization tests failed on the non-zero KEK before the fix, and each carried
  its original error (`invalid_private_key_format`, `rng_unavailable`,
  `storage_write_failed`) — not wrong-reason failures;
- 6 of the 7 render-boundary tests go red when `isAllowedRemoteUrl` is removed from
  `RemoteUrlField` (verified by mutation, then reverted). The seventh is the `https:`
  happy path, which correctly stays green.

## Score movement, stated honestly

**80 → 86 is not "six points of improvement", and the change was never aimed at the
number.**

- `.aislop/config.yml` records the score when aislop was wired in as **75**, with the
  floor set to **70**. The floor was never the measured score. Against that 75, the
  current 86 is **11 points across two changes, not this one**.
- This change moved 80 → 86. Of the 50 warnings cleared, **11 are suppressions of
  findings that were false positives** — the code did not change at those sites — and 2
  more came from shortening comments. Only the remaining ~37 are code changes, chiefly
  the 32 `as any` casts removed in groups 6–8.
- The dependency audit **completing rather than timing out** also contributes to the
  score, and is not a code improvement at all.

**One warning was added, not removed.** `complexity/file-too-large` went 10 → 11:
`remote-media-policy.test.tsx` grew 310 → 439 lines by gaining the render-boundary
tests the `remote-media-policy` delta requires. Splitting a test file to get under a
line count would be churn — `design.md` disposition #31 already records that this rule
is a review prompt, not a defect. Left as is, and reported rather than netted away.

`ci.failBelow` stays at **70** (`design.md` D8). Raising it is deliberately not part of
this change.

## The audit is not clean

One advisory remains: **esbuild 0.27.7, low severity** (GHSA-g7r4-m6w7-qqqr, CWE-22 —
arbitrary file read via the dev server on Windows; patched in >= 0.28.1). Confirmed at
implementation time: **9 dependency paths, all `dev: true`**, all arriving through
`wxt` / `@wxt-dev/*`. It does not establish a vulnerability in the shipped extension
and does not breach `verify.yml`'s `--audit-level high` gate, which exits 0. It remains
a tracked maintenance item and **no claim of a clean audit is made anywhere.**

## Found during implementation, deliberately NOT done

- **`profile-rpc.ts`** has the identical `default`-branch cast pattern at `:30,31` and
  three `(message as any).params` reads at `:41,81,131`. It was missed when the eight
  handlers were triaged. Left untouched so this change delivers exactly the 16 casts its
  acceptance criteria name. First item for the follow-up. See `design.md` D7 (a′).
- **`docs/TESTING.md` counts were already stale at baseline** and by far more than this
  change's ±7: documented 28 files/386 tests for `unit` against an actual 45/705, and
  6/133 for `security` against 29/575. Three per-file counts were stale too. Rather than
  re-rotting them, the counts were **removed**, which is what that document's own policy
  already demanded ("Counts are deliberately absent from this document ... Every figure
  previously written here rotted, twice").
- **A pre-existing `aislop-ignore` directive in `client.ts` is redundant**, as one was at
  baseline (11 directives / 10 suppressed; now 22 / 21). Left rather than churned, per
  `design.md` D6.

## Open question resolved

**No handler's `switch` narrows `default` to `never`.** `pnpm run compile` was run after
each of the eight handlers individually and was clean every time, so no `never`-safe
read was needed anywhere and no cast was traded for another cast.

## Not required

No UI renders differently, so **no design review or screenshot capture was triggered**.
The `RemoteUrlField` tests are non-visual assertions about an existing component.

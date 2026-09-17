## Why

A security test that cannot fail is worse than no test at all. It converts an unverified assumption into a claim of assurance, and that claim is why a real flaw stays unfixed. Ostrilo currently advertises a security suite in `docs/TESTING.md`, and two of the three files in `tests/security/` prove materially less than their names promise.

`tests/security/memory-zeroization.test.ts:4-15` replaces `zeroize` with `vi.fn()` and then asserts call counts. The function under test is the mock, so the suite cannot observe whether a single byte was ever cleared, and it cannot see the copies of key material that survive the operation. Those copies are real: `toArrayBuffer` in `src/infrastructure/crypto/adapters.ts:10-14` clones the raw AES key, the IV and the plaintext into fresh `ArrayBuffer`s that nothing zeroizes, and `unlock()` in `src/application/services/key-vault.service.ts:306-336` zeroizes a throwaway `TextEncoder` copy of the password while passing the immutable `password` string itself to `deriveKey`. The entropy test in `tests/security/crypto-security.test.ts:50-77` generates three keys and asserts only that their ids and pubkeys differ and match `^[0-9a-f]{64}$`; a counter returning 1, 2, 3 would pass it.

Beyond what the tests fail to prove, three gaps make the whole verification story unsound. There are no official BIP-340 or NIP-01 known-answer vectors anywhere in the repo, so nothing proves Ostrilo's signatures are correct or interoperable rather than merely self-consistent. There is no regression test for any security parameter that matters: nothing fails if the KDF iteration count drops, if the RNG source is swapped, if a policy check is deleted, if `getLockState` is made to fail open, or if a password gate is weakened. And `.github/workflows/` contains exactly one file, `react-doctor.yml` — no workflow runs `pnpm test`, `tsc --noEmit`, a build, or a dependency audit, so not one of the 37 Vitest files blocks a merge.

Finally, the tooling this project mandates for verification is itself an unpinned network fetch running on the machine that holds signing keys, and it is currently broken. `AGENTS.md` and `docs/development-standards.md` require `npx react-doctor@latest` after every code edit; `package.json:31` defines `"doctor": "npx react-doctor@latest"`; `.git/hooks/pre-commit:15-23` and `.claude/hooks/react-doctor.sh:53-61` fall back to `pnpm dlx react-doctor@latest` and then `npx --yes react-doctor@latest`. Each of those bypasses `pnpm-lock.yaml` and pulls a full transitive tree from the network. During the security review the hook fired repeatedly and pnpm refused every install with `[ERR_PNPM_TRUST_DOWNGRADE]` for `semver@6.3.1` under `react-doctor@0.9.13`, so React Doctor never ran and produced no findings. The project's own supply-chain policy in `pnpm-workspace.yaml` (`minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`) is working exactly as intended; the `@latest` invocation is what violates it. Because every other change in this remediation programme ends its Verification group with a React Doctor requirement, fixing this unblocks the entire programme.

## What Changes

- Rewrite `tests/security/memory-zeroization.test.ts` so it exercises the real `zeroize` and asserts on actual buffer bytes after the operation, and so it fails when a surviving copy of key material is retained.
- State the zeroization guarantee honestly: `Uint8Array` secrets are overwritten, but a JavaScript string cannot be erased, so the testable property for string-typed secrets is that no unnecessary copy is retained and references are dropped promptly.
- Add coverage for the unzeroized `toArrayBuffer` copies of the raw key, IV and plaintext, and for the `password` string that reaches `deriveKey` in `unlock()`.
- Replace the entropy test with a real strategy: known-answer vectors for the deterministic parts, an assertion that the RNG source is the platform CSPRNG and not a fallback, and a statistical smoke check with a stated false-failure rate.
- Vendor the official BIP-340 and NIP-01 test vectors and add cross-implementation known-answer tests, including the NIP-01 serialization edge cases verified by hand: control characters `U+0001`-`U+001F`, `U+2028`/`U+2029`, `U+007F`, and a lone surrogate such as `U+D800`.
- Add a named security-invariant regression test for each real defect found in this codebase, so that reverting the fix turns a test red.
- Make the test-harness seam safety in `vitest.setup.ts` an explicit requirement, so no future edit can introduce a weak-RNG substitution or make test-only crypto reachable from `src/`.
- Resolve `tests/test-crypto.ts`, a console-logging script that Vitest never collects because its filename has no `.test.`/`.spec.` infix and that nothing in the repo imports.
- Add a CI workflow that runs typecheck, unit, integration and security suites, builds both Chrome and Firefox targets, and runs a dependency audit, and make it a required status check.
- Pin React Doctor as an exact-version devDependency invoked through the local binary, remove every `@latest` network fetch from `package.json`, `.git/hooks/pre-commit` and `.claude/hooks/react-doctor.sh`, and make the hooks fail loudly instead of silently skipping when the pinned tool is absent.
- Reword the `AGENTS.md` and `docs/development-standards.md` React Doctor rule so a code-quality linter score is not a blocking release gate.
- Add supply-chain gates appropriate to a wallet-class project: lockfile integrity, provenance verification, automated dependency updates, and a reproducible-build story.

## Capabilities

### New Capabilities

- `security-test-assurance`: Every security test must be able to fail for the right reason - no mocking the unit under test, assertions on real buffer contents, honest scope statements about what JavaScript cannot guarantee, and a test harness that can never weaken production crypto.
- `crypto-interop-vectors`: Vendored official BIP-340 and NIP-01 known-answer vectors proving Ostrilo's event ids and Schnorr signatures are correct and interoperable, including the NIP-01 serialization edge cases.
- `security-invariant-regression`: One named regression test per real security defect fixed in this codebase, so each fix is locked in and a revert turns a test red.
- `ci-verification-gates`: A required CI status check that runs typecheck, unit, integration and security suites, both browser builds, and a dependency audit before any merge.
- `supply-chain-integrity`: No unpinned network fetch of executable tooling on a machine holding signing keys, plus lockfile integrity, provenance verification, automated dependency updates, and reproducible-build verification.

### Modified Capabilities

- `key-vault`: `Memory Zeroization` currently asserts that passwords are zeroized alongside private keys and derived keys. That is not achievable for a JavaScript string. The requirement is restated to separate the buffer guarantee (overwritten) from the string guarantee (no retained copy, references dropped promptly), so the spec describes something a test can actually verify.

## Impact

- Security tests: `tests/security/memory-zeroization.test.ts` is rewritten without mocking `zeroize`; `tests/security/crypto-security.test.ts` loses its non-assertion entropy case and gains real checks.
- New test assets: vendored BIP-340 and NIP-01 vector files plus the loader that feeds them into Vitest.
- Crypto surfaces under test: `src/infrastructure/crypto/adapters.ts` (`toArrayBuffer` copies), `src/application/services/key-vault.service.ts` (`unlock`, `lock`, `encryptPrivateKey`, `revealKey`), and `src/domain/utils/crypto.ts` (`zeroize`, `computeEventId`, `signEventHash`, `verifyEventSignature`).
- Test configuration: `vitest.config.ts` and `vitest.setup.ts` gain an explicit seam-safety contract; the security suite may need its own project or include pattern.
- CI: a new workflow under `.github/workflows/`, joining the existing `react-doctor.yml`, plus branch-protection configuration to make it required.
- Tooling and hooks: `package.json` scripts and devDependencies, `.git/hooks/pre-commit`, `.claude/hooks/react-doctor.sh`, and `pnpm-workspace.yaml` trust settings.
- Docs: `AGENTS.md` and `docs/development-standards.md` React Doctor wording; `docs/TESTING.md` test counts are stale (it claims 73 tests across 8 files against 37 collected Vitest files) and must be corrected alongside the new suites.
- PRD: `SEC-001`, `SEC-005` and `SEC-017` are the rows this change moves; `SEC-018` is informed by the RNG-source assertion.
- Companion changes: `consolidate-crypto-implementations` should not proceed until the interop vectors exist, and `harden-vault-key-derivation`, `enforce-password-policy`, `implement-session-auto-lock`, `fix-consent-policy-defects` and `remove-key-exfiltration-surface` each contribute one invariant to lock in. Every change in the programme currently deferring its React Doctor verification step is unblocked by the pinning work here.

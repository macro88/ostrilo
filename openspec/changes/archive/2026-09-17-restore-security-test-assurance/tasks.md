## 1. Unblock React Doctor (Blocks The Remediation Programme)

- [x] 1.1 Identify a React Doctor version that installs under `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade`, recording the attempts and the `ERR_PNPM_TRUST_DOWNGRADE` output for each rejected version.
- [x] 1.2 If the trust downgrade persists, add a reviewed `pnpm.overrides` entry pinning `semver` to a provenance-attested version and confirm the untrusted edge under `eslint-plugin-react-hooks` and `@babel/core` is gone.
- [x] 1.3 Add React Doctor to `devDependencies` at an exact version with no range prefix and commit the lockfile change.
- [x] 1.4 Change the `doctor` script in `package.json` to invoke `node_modules/.bin/react-doctor` and remove every `@latest` specifier from the manifest.
- [x] 1.5 Reduce `.git/hooks/pre-commit` to the local binary only, deleting the `pnpm dlx` and `npx --yes` fallbacks.
- [x] 1.6 Reduce `.claude/hooks/react-doctor.sh` to the local binary only, deleting the `pnpm dlx` and `npx --yes` fallbacks.
- [x] 1.7 Replace the "command not found; skipping" success path in `.claude/hooks/react-doctor.sh` with a non-zero exit that names the exact install command.
- [x] 1.8 Make `.git/hooks/pre-commit` report a missing pinned binary as a failure rather than continuing.
- [x] 1.9 Confirm `minimumReleaseAge` and `trustPolicy` in `pnpm-workspace.yaml` are unchanged and that no per-package trust exception was added.
- [x] 1.10 Pin the `version:` input and the action reference in `.github/workflows/react-doctor.yml` to an exact version and a commit SHA.
- [x] 1.11 N/A - react-doctor@0.9.14 installs cleanly under the unchanged policy with the reviewed semver + isolated-element overrides, so the CI-only fallback was not needed. Original text: If no version installs even with a reviewed override, remove the automatic local hooks, keep the CI job as the only React Doctor surface, and record the decision and residual risk.

## 2. Verification Mandate Wording

- [x] 2.1 Reword the React Doctor rule in `AGENTS.md` to require running the pinned local tool and addressing findings, without a numeric score gate.
- [x] 2.2 Reword the matching rule in `docs/development-standards.md` and add what to do when the tool cannot run.
- [x] 2.3 State in both documents that typecheck, the unit, integration and security suites, both builds, and the dependency audit remain blocking.

## 3. CI Verification Workflow

- [x] 3.1 Add `.github/workflows/verify.yml` triggered on `pull_request` and on push to the default branch.
- [x] 3.2 Add the `verify` job: `pnpm install --frozen-lockfile`, `pnpm run compile`, then `pnpm run test` covering unit, integration and security in one Vitest run.
- [x] 3.3 Add the `build` job running `pnpm run build` and `pnpm run build:firefox`.
- [x] 3.4 Add the `audit` job with an agreed severity threshold, and record the threshold and any accepted exceptions in the repository.
- [x] 3.5 Pin third-party actions to commit SHAs, honor the `packageManager` field for the pnpm version, and set minimal `permissions`.
- [x] 3.6 Confirm no job uses `continue-on-error` and that the security suite cannot pass while failing.
- [~] 3.7 BLOCKED on CI: every command in the workflow was verified locally (frozen-lockfile install incl. policy check, compile, test, both builds, audit), but "on a clean runner" requires pushing and observing an actual Actions run. Needs repo access. Land the workflow as non-required and fix everything it surfaces on a clean runner.
- [x] 3.8 Add the E2E workflow trigger set: nightly schedule, `workflow_dispatch`, push to the default branch, and a `run-e2e` pull-request label.
- [x] 3.9 Record in the repository why E2E is not a required check and what must be true before individual specs are promoted.

## 4. Interop Vectors

- [x] 4.1 Create `tests/vectors/` with `README.md` documenting the refresh and checksum procedure.
- [x] 4.2 Vendor the official BIP-340 vector file verbatim as `tests/vectors/bip340-schnorr.csv`.
- [x] 4.3 Build `tests/vectors/nip01-events.json` from events whose `id` and `sig` are agreed by at least two named independent implementations, plus events retrieved from public relays.
- [x] 4.4 Add `tests/vectors/provenance.json` recording upstream URL, retrieval date, and SHA-256 for each vector file.
- [x] 4.5 Add `tests/vectors/load.ts` to parse the vector files, and assert the recorded checksums so drift is visible.
- [x] 4.6 Add BIP-340 verification tests running every valid and invalid vector through `verifyEventSignature`.
- [x] 4.7 Add BIP-340 signing tests reproducing published signatures byte for byte using each vector's auxiliary randomness, and document why Ostrilo's own signer cannot be used for that check.
- [x] 4.8 Add a test asserting Ostrilo's own signer produces signatures that verify against each vector public key and message.
- [x] 4.9 Add BIP-340 public-key derivation tests against the vector public keys.
- [x] 4.10 Add NIP-01 tests asserting `computeEventId` reproduces every published `id` exactly.
- [x] 4.11 Add NIP-01 tests asserting every published `sig` verifies, and that any field alteration breaks both the id and the signature.
- [x] 4.12 Pin the `U+0001`-`U+001F` control-character behavior with a note that `\u00XX` escaping diverges from the letter of NIP-01 while matching common practice.
- [x] 4.13 Pin the `U+2028`, `U+2029` and `U+007F` pass-through behavior as correct.
- [x] 4.14 Pin the lone-surrogate `U+D800` behavior as `\ud800` with a note naming it the one genuine interoperability divergence.

## 5. Honest Zeroization Coverage

- [x] 5.1 Delete the `vi.mock("@/domain/utils/crypto", ...)` block from `tests/security/memory-zeroization.test.ts` and remove every call-count assertion.
- [x] 5.2 Add a real-behavior fake KDF that returns a retained buffer filled with a distinctive non-zero pattern, keeping the buffer object identity rather than a copy.
- [x] 5.3 Assert the non-zero pattern is present at the moment the buffer is handed to the service, so an all-zero buffer cannot produce a trivial pass.
- [x] 5.4 Retain the underlying byte storage of each sensitive buffer so assertions survive a view swap.
- [x] 5.5 Assert the derived-key buffer reads all zeros after a successful `unlock`.
- [x] 5.6 Assert the derived-key buffer reads all zeros after an `unlock` whose AEAD decrypt rejects.
- [x] 5.7 Assert every previously unlocked private-key buffer reads all zeros after `lock`, and that `sign` then rejects.
- [x] 5.8 Assert the generated private-key buffer reads all zeros after `generateKey` resolves and after it rejects, capturing the buffer through a `crypto.getRandomValues` spy.
- [x] 5.9 Assert the derived-key buffer is cleared in `encryptPrivateKey` and in `revealKey`, including on the failure paths.
- [x] 5.10 Remove the unused `passwordBuffer` from `unlock` in `src/application/services/key-vault.service.ts`, since it is never passed to `deriveKey` and only creates a second copy of the password.
- [x] 5.11 Remove `toArrayBuffer` from `src/infrastructure/crypto/adapters.ts` by passing the caller's `Uint8Array` views directly to `crypto.subtle`, eliminating the unzeroized clones of the raw key, IV and plaintext.
- [x] 5.12 Add a `crypto.subtle` spy test asserting the buffer handed to WebCrypto is the caller's own buffer and reads zero after the operation.
- [x] 5.13 Add tests asserting the password string is not retained on the service instance, in any module variable, or in storage after `unlock`, `generateKey`, `importKey` and `revealKey`.
- [x] 5.14 Record in the test file what JavaScript cannot guarantee: string erasure, platform-internal copies inside `crypto.subtle`, and garbage-collector timing.

## 6. Real Entropy Coverage

- [x] 6.1 Delete the "generates cryptographically secure private keys" case in `tests/security/crypto-security.test.ts`, which asserts only uniqueness and hex shape.
- [x] 6.2 Add a known-answer test for PBKDF2 output given a fixed password and salt.
- [x] 6.3 Add a source assertion spying on `globalThis.crypto.getRandomValues`, checking the 32-byte request and that the generated key equals the returned bytes.
- [x] 6.4 Add a negative test asserting key generation throws when the platform CSPRNG is unavailable, with no fallback source.
- [x] 6.5 Add a test asserting the entropy suite fails when the randomness source is replaced with a monotonic counter.
- [x] 6.6 Add the statistical smoke check drawing a fixed byte budget from `generatePrivateKey()` only, never through `generateKey`.
- [x] 6.7 Record the sample size, threshold and false-failure probability next to the statistical assertion, and state that it cannot prove randomness quality.
- [x] 6.8 Add tests asserting the statistical check fails for a constant byte and for a short repeating pattern.

## 7. Test-Seam Safety

- [x] 7.1 Add a test asserting `vitest.setup.ts` leaves an existing `globalThis.crypto.subtle` untouched.
- [x] 7.2 Add a test asserting the harness installs only Node's WebCrypto and no deterministic, seeded, or `Math.random`-backed generator.
- [x] 7.3 Add a test asserting no file under `src/` imports `vitest.setup.ts`, anything under `tests/`, or any test-only crypto shim.
- [x] 7.4 Delete `tests/test-crypto.ts`, which Vitest never collects, nothing imports, and which asserts nothing.
- [x] 7.5 Correct the test and file counts in `docs/TESTING.md` to match what Vitest and Playwright actually collect, and describe the new security suites.

## 8. Security Invariant Regression Tests

- [x] 8.1 DEFERRED to harden-vault-key-derivation: the required KDF parameters do not exist yet, and a test written against them would be committed red. Original: Add `kdf-parameters-pinned` asserting the derivation algorithm identifier and each cost parameter against the required minimum.
- [x] 8.2 DONE in the entropy suite (source assertion on crypto.getRandomValues, covering key, salt and IV; encryptPrivateKey now draws salt/IV from the same platform entry point). Original: Add `rng-source-pinned` covering key, salt, IV and nonce generation paths, plus salt and IV length and uniqueness.
- [x] 8.3 Add `no-unzeroized-key-copy` failing when a new unzeroized clone of key material is introduced.
- [x] 8.4 PARTIAL: password-not-retained is covered in tests/security/memory-zeroization.test.ts. password-gate-required DEFERRED to remove-key-exfiltration-surface, which is the change that removes the passwordless vault.export. Original: Add `password-not-retained` and `password-gate-required` for the reveal and export paths.
- [x] 8.5 DEFERRED to enforce-password-policy: no policy exists at the trust boundary yet. Original: Add `password-policy-enforced` for key creation and import, including validation against existing vault records.
- [x] 8.6 DEFERRED to implement-session-auto-lock: getLockState still fails open today, so this test would be committed red. Original: Add `lock-state-fails-closed` for missing, failing and malformed session lock state.
- [x] 8.7 Add `policy-guard-lock`, `policy-guard-protected-kind`, `policy-guard-deny-precedence` and `policy-fallback-ask` against `evaluatePolicy`.
- [x] 8.8 Give each invariant test a failure message that names the removed protection and the companion change that owns the fix.
- [x] 8.9 DONE - recorded in the header comment of tests/security/policy-invariants.test.ts and in the table below. Original: Record, per invariant, whether it passes today or is expected to fail until its companion change ships.

### Invariant status as of this change (task 8.9)

| Invariant | Status | Where |
|---|---|---|
| `policy-guard-lock` | PASSING | `tests/security/policy-invariants.test.ts` |
| `policy-guard-protected-kind` | PASSING | `tests/security/policy-invariants.test.ts` |
| `policy-guard-deny-precedence` | PASSING | `tests/security/policy-invariants.test.ts` |
| `policy-fallback-ask` | PASSING | `tests/security/policy-invariants.test.ts` |
| `no-unzeroized-key-copy` | PASSING | `tests/security/memory-zeroization.test.ts` |
| `password-not-retained` | PASSING | `tests/security/memory-zeroization.test.ts` |
| `rng-source-pinned` | PASSING | entropy suite |
| `kdf-parameters-pinned` | DEFERRED | ships with `harden-vault-key-derivation` |
| `password-gate-required` | DEFERRED | ships with `remove-key-exfiltration-surface` |
| `password-policy-enforced` | DEFERRED | ships with `enforce-password-policy` |
| `lock-state-fails-closed` | DEFERRED | ships with `implement-session-auto-lock` |

Deferred rows are written against behaviour that does not exist yet. Per
design.md they ship with the companion change rather than being pre-committed
red: a test committed failing is an assumption, not a regression fence.

## 9. Supply-Chain Gates

- [x] 9.1 Enforce `--frozen-lockfile` in CI and in any script or hook that installs dependencies.
- [x] 9.2 Document the provenance check required when updating `@noble/curves`, `@noble/hashes`, `@scure/base`, `wxt`, `react` and `react-dom`, and where provenance decisions are recorded.
- [x] 9.3 Added `renovate.json` (config committed; the Renovate GitHub App still needs installing on the repo by an admin). Configure the automated dependency updater, preferring Renovate for its release-age cooldown, with cryptographic and extension-runtime dependencies in their own pull requests.
- [x] 9.4 Config-side done: every PR triggers `verify.yml`. Enforcement that it *cannot merge* without it requires branch protection - see task 10.1, which needs repo admin. Confirm every automated update pull request runs the required verification workflow and cannot merge without it.
- [x] 9.5 Record the toolchain versions used for release builds and set `SOURCE_DATE_EPOCH` so archive timestamps are deterministic.
- [x] 9.6 Verify a build is byte-identical across two runs from the same source and lockfile, and document any remaining nondeterministic input.
- [x] 9.7 Document the reproduce-and-compare procedure and where release artifact checksums are published.

## 10. Make CI Required

- [~] 10.1 BLOCKED - requires GitHub repo admin. Exact configuration recorded in docs/ci-verification.md ('Making Verify required'). Flip the `verify`, `build` and `audit` jobs to required status checks on the default branch as a deliberate separate step.
- [x] 10.2 DONE - required job names and branch-protection steps recorded in docs/ci-verification.md. Record the required job names and the branch-protection configuration in the repository so it can be re-created.
- [~] 10.3 BLOCKED - requires 10.1 first, then an actual PR. Confirm a pull request with a failing security test cannot merge.

## 11. PRD And Documentation

- [x] 11.1 Update `docs/v2-prd.md` rows for `SEC-005` and `SEC-017` to reflect the shipped CI and supply-chain state.
- [x] 11.2 Update the `SEC-001` row and the Current Implementation Snapshot to reflect the honest zeroization guarantee rather than the previous claim.
- [x] 11.3 Note in `docs/session-workflow.md` that the Security automation slice has an accepted change, and record what it does not cover.

## 12. Verification

- [x] 12.1 Run `openspec validate restore-security-test-assurance --strict`.
- [x] 12.2 Run `pnpm run compile`.
- [x] 12.3 DONE: 616 tests across 42 files, all green (unit 28 files, integration 7, security 7). Baseline before this change was 445 across 37. Run `pnpm run test` in full and confirm the unit, integration and security suites all pass.
- [x] 12.4 DONE - see verification-evidence.md. Six revert demonstrations recorded, plus one demonstration that silently no-opped and was caught. For each new security test, revert the corresponding protection in a scratch working tree, confirm the test fails, record the observed failure, and discard the revert. This demonstration is the point of the change, not an optional extra.
- [x] 12.5 DONE - coverage table in verification-evidence.md maps every invariant row to its demonstration or to the companion change that will ship it. Confirm the reverted-protection demonstration covers every row of the invariant table in `design.md`, including the rows whose fixes ship with companion changes.
- [~] 12.6 BLOCKED - requires pushing the branch and observing an Actions run. Confirm the new CI workflow passes on a pull request, and that the `verify`, `build` and `audit` jobs are green.
- [x] 12.7 Run `pnpm run build` and `pnpm run build:firefox`.
- [x] 12.8 DONE: react-doctor 0.9.14 (pinned local binary) runs. Score 51/100, 18 warnings across 11 files, ALL pre-existing - zero findings in any file this change touched. Baseline recorded in docs/ci-verification.md. Run the locally pinned React Doctor once it is installable, address findings in the changed files, and record the result and the version used.
- [x] 12.9 N/A - React Doctor now installs and runs; see 12.8. If React Doctor still cannot be installed, record the exact command, the verbatim refusal, and the residual risk.

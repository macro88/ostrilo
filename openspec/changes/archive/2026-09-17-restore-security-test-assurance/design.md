## Context

Ostrilo's verification story has four independent breaks, and they compound.

The security suite is small and partly inert. `tests/security/memory-zeroization.test.ts:5-15` installs a module mock that replaces `zeroize` with `vi.fn()`, then asserts call counts such as `toHaveBeenCalledTimes(2)`. Every service under test is also a `vi.fn()` mock, so the suite verifies that `KeyVaultService` calls a function that does nothing, in an environment where no real key material exists. It cannot observe a cleared byte, and it cannot see the copies that survive. The entropy case at `tests/security/crypto-security.test.ts:50-77` asserts uniqueness and hex shape only.

The copies it cannot see are real. `toArrayBuffer` at `src/infrastructure/crypto/adapters.ts:10-14` clones its argument into a fresh `ArrayBuffer`, and it is applied to the raw AES key on import, to the IV, and to the plaintext on both encrypt and decrypt. Nothing zeroizes those clones. `unlock()` at `src/application/services/key-vault.service.ts:306-336` builds `passwordBuffer = new TextEncoder().encode(password)` and zeroizes it in the `finally`, but that buffer is never used for anything - the string `password` is what reaches `this.kdf.deriveKey(password, salt)` at line 316. The zeroization is ceremony around a copy the code created for no reason, and the actual secret is an immutable string that cannot be erased.

Nothing proves the crypto is correct rather than self-consistent. `tests/unit/domain/nostr-events.test.ts:14` says "Test vector" but asserts only `/^[0-9a-f]{64}$/`; every signing test signs and then verifies with the same code, which would pass equally well for a wrong-but-consistent implementation. There is no BIP-340 vector file and no NIP-01 known-answer event anywhere in the repository.

Nothing runs any of it. `.github/workflows/` contains exactly one file, `react-doctor.yml`. There is no typecheck, test, build, or audit workflow, so 37 collected Vitest files and 19 Playwright specs have no bearing on whether a change merges.

And the one tool the project does mandate cannot run. `AGENTS.md` and `docs/development-standards.md` require `npx react-doctor@latest` after every code edit. `package.json:31`, `.git/hooks/pre-commit:15-23`, and `.claude/hooks/react-doctor.sh:53-61` all reach the network for an unpinned package on the machine that holds the developer's signing keys. `pnpm-workspace.yaml` already sets `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade`, and those settings correctly refuse the install:

```
[ERR_PNPM_TRUST_DOWNGRADE] High-risk trust downgrade for "semver@6.3.1"
(possible package takeover)
  ...while installing the dependencies of react-doctor@0.9.13
  at eslint-plugin-react-hooks@7.1.1 at @babel/core@7.29.7
```

This reproduces on every edit. The project's supply-chain policy is not the problem; the `@latest` invocation that bypasses the lockfile is. Because every other change in this remediation programme ends its Verification group with a React Doctor step, that programme is currently blocked on a broken tool fetch.

One piece of good news deserves to be recorded and then protected. `vitest.setup.ts:6` assigns Node's WebCrypto only when `!globalThis.crypto || !globalThis.crypto.subtle`, installs nothing weaker, and nothing under `src/` imports anything from `tests/` or the setup file. There is no weak-RNG seam in a production build today. That is a property worth locking down before someone adds one for convenience.

## Goals / Non-Goals

**Goals:**

- Make every security test able to fail for the right reason, and demonstrate that it does.
- Replace mock-call-count zeroization assertions with assertions on real buffer bytes.
- State honestly what JavaScript cannot guarantee, and reduce the surface where that matters.
- Prove signing correctness and interoperability with known-answer vectors from outside this codebase.
- Lock in each real security fix with a named regression test.
- Make CI a required gate covering typecheck, tests, both builds, and a dependency audit.
- Remove every unpinned network fetch of executable tooling, and make tool failure loud.
- Unblock the React Doctor verification step for the rest of the remediation programme.

**Non-Goals:**

- No new cryptographic primitive, KDF change, or storage format change. Those belong to `harden-vault-key-derivation`.
- No merging of the duplicate crypto implementations. That is `consolidate-crypto-implementations`, which this change unblocks rather than performs.
- No CSP or manifest scanning and no bundle-size gate. Those belong to `harden-manifest-and-build`.
- No fuzzing, mutation testing, or property-based testing framework in this slice.
- No formal side-channel or timing analysis. The existing timing claims in `docs/TESTING.md` are not strengthened here.
- No secrets-scanning tool selection beyond the CI hook point, and no code-signing or store-submission automation.

## Decisions

### Decision 1: A security test must be able to fail for the right reason

The governing rule for this change: for every security test, name the protection it covers, then confirm that removing that protection turns the test red. Any test that cannot be made to fail by removing the thing it claims to verify is deleted or rewritten, not kept for the count.

Two consequences follow. First, a test may never mock the unit under test. Mocking a collaborator is fine and often necessary; mocking `zeroize` in a zeroization test is the defect. Second, an assertion must observe an effect, not an invocation. `expect(zeroizeSpy).toHaveBeenCalledWith(buf)` is satisfied by a `zeroize` that does nothing; `expect([...buf]).toEqual(zeros)` is not.

**Rationale:** False assurance is a security defect in its own right. It is the mechanism by which a real flaw survives review: the reviewer sees a green suite named after the property and stops looking. The unzeroized `toArrayBuffer` clones and the never-used `passwordBuffer` both sat behind a passing suite called "Memory Zeroization Security Tests".

**Alternative considered:** Keep the call-count tests as a cheap smoke check and layer real tests on top. Rejected. Two suites asserting the same property at different strengths means the weak one gets updated when the strong one breaks, and the name on the file is what reviewers trust.

### Decision 2: Assert zeroization by retaining the byte storage and reading it afterwards

`zeroize` is `buffer.fill(0)`, an in-place mutation of the backing `ArrayBuffer`. So a test that holds the same `Uint8Array` object the production code holds will observe the clearing directly. `KeyVaultService` takes `CryptoKdf`, `CryptoAead` and `Schnorr` through the constructor, which gives the test a legitimate seam for handing in buffers it keeps.

The technique, concretely:

- Build a real-behavior fake KDF that fills a 32-byte buffer with a distinctive non-zero pattern, pushes the buffer object itself into a test-visible array, and returns that same object. Never push a copy - the identity of the object is the whole point.
- Assert the pattern is present at handoff. This is the guard against the trivial pass: an all-zero derived key would satisfy the post-condition without anything having been cleared, so the test must first prove the buffer was non-zero when the service received it.
- Retain the byte storage, not only the view: `const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)`. If production code later swaps the view for another over the same storage, the assertion still reads the memory that mattered.
- Run the operation, then assert every byte of every retained buffer reads zero. Run it again with the AEAD rejecting, and assert the same, which covers the `finally`.

The same shape covers the other buffers. For decrypted private keys, the fake AEAD `decrypt` returns a retained non-zero 32-byte buffer; `unlock` stores that exact object in the `unlocked` map, and `lock` zeroizes it, so the test reads the bytes after `lock()` and additionally confirms `sign()` now rejects. For the private key that `generateKey` creates internally there is no injection seam, but `crypto.getRandomValues` fills and returns the very array passed to it, so a spy on `crypto.getRandomValues` yields a reference to the exact buffer the service will zeroize.

**Rationale:** This is the only technique that distinguishes "we called the cleanup function" from "the bytes are gone", and it needs no access to private fields beyond what dependency injection already exposes.

**Alternative considered:** Heap snapshots or `WeakRef`-based reachability checks to prove no copy survives. Rejected for this slice: heap inspection under Vitest is slow, flaky across Node versions, and cannot distinguish our copy from the platform's. It is worth revisiting only if a specific leak resists direct assertion.

### Decision 3: Be explicit about what is untestable, and shrink it

Three things are genuinely beyond reach in JavaScript, and the specs and tests must say so rather than imply coverage.

A string secret cannot be erased. `password` is immutable and its backing storage is not addressable from script; the engine may also have interned it, copied it during GC, or spilled it to a register or the stack. So the testable property is narrower and honest: no unnecessary copy is created, no instance property or module variable retains the value, and references are dropped when the operation completes. A test can walk the service's own enumerable properties and its serialized form and assert the password does not appear.

Platform-internal copies are also beyond reach. `crypto.subtle.importKey` copies the key bytes into an opaque `CryptoKey`; we cannot see or clear that, and we should not pretend to.

Garbage-collector timing is beyond reach. Dropping a reference is not erasure, only permission to erase.

What we can do is reduce the surface. Two reductions fall out of the findings and should land with the tests, because a test asserting a property the code violates is not landable:

- Delete the `passwordBuffer` in `unlock()`. It is never passed to `deriveKey`, so encoding it creates a second copy of the secret purely to have something to zeroize. Removing it strictly decreases the number of copies of the password in memory, and it removes a line that misleads readers into believing the password is being cleared.
- Stop cloning key material in `toArrayBuffer`. WebCrypto accepts any `BufferSource`, so passing the caller's `Uint8Array` view directly removes three unzeroized clones per operation - raw key, IV, plaintext - and, more importantly, makes the property testable: the buffer handed to `crypto.subtle` becomes the same object the caller already zeroizes, so a spy on `crypto.subtle` can assert both identity and that the bytes read zero afterwards.

**Rationale:** An untestable claim in a spec is a claim that will be believed and never checked. Where the untestability comes from an avoidable copy, delete the copy; where it is intrinsic to the language, write it down.

**Alternative considered:** Keep `toArrayBuffer` and test only that the clones are unreachable. Rejected: unreachability is not observable from a test, so the requirement would be unverifiable - the exact failure mode this change exists to remove.

### Decision 4: Three-part entropy strategy, with the statistical part clearly labelled

There is no test that proves a generator is random. So the entropy work splits into three parts with different strengths, and each says which it is.

**Known-answer tests for the deterministic parts.** Public-key derivation from a fixed secret key, `computeEventId` over fixed event fields, PBKDF2 output for a fixed password and salt, and BIP-340 signing with supplied auxiliary randomness. These are real proofs of correctness and they carry most of the value.

**A source assertion for the non-deterministic part.** Spy on `globalThis.crypto.getRandomValues`, assert it is requested for exactly 32 bytes, and assert the resulting private key equals the bytes the platform returned. Then assert the negative: with `crypto.getRandomValues` unavailable, key generation throws rather than degrading to any other source. `generatePrivateKey()` routes through `@noble/hashes` `randomBytes`, which delegates to the same platform entry point, so both the domain and service paths are covered by one assertion pair. This is what actually catches an RNG swap, and it is what the current test completely misses.

**A statistical smoke check, explicitly bounded.** Draw a fixed budget of bytes from `generatePrivateKey()` directly - never through `generateKey`, whose 100,000-iteration PBKDF2 would make the loop unusable in CI - and run a monobit count plus a byte-frequency chi-square. With 4,000 keys the sample is 128,000 bytes, so 1,024,000 bits, expected mean 512,000 and standard deviation 506. A 5-sigma two-sided threshold gives a false-failure probability of roughly 6 in 10,000,000, and that number is written next to the assertion along with the sample size and threshold.

State plainly in the test file what this cannot do. A monobit or chi-square test passes for any competent stream cipher and for many broken generators; it detects gross breakage only - a constant byte, a short repeating pattern, truncated entropy, a stuck bit. It is a smoke alarm, not a proof, and it must never be described as verifying entropy quality.

**Rationale:** The current test proves nothing and is named as though it proves everything. Splitting by strength lets each part be trusted for exactly what it establishes.

**Alternative considered:** Vendor a NIST SP 800-22 style battery. Rejected: minutes of CI time, a meaningful false-failure rate across a dozen sub-tests, and no additional protection against the failure modes a signer actually faces, which are a swapped source or a truncated draw - both caught by the source assertion.

### Decision 5: Vendor vectors as data, with provenance, and be accurate about what is official

Layout under `tests/vectors/`:

- `bip340-schnorr.csv` - the official BIP-340 vector file from the `bitcoin/bips` repository, verbatim.
- `nip01-events.json` - cross-implementation event vectors.
- `provenance.json` - for each file: upstream URL, retrieval date, SHA-256 of the retrieved bytes.
- `README.md` - how to refresh a file and re-record its checksum.
- `load.ts` - the loader that parses the files and feeds them to Vitest.

BIP-340 publishes an authoritative vector file, and it is used as-is. The verification vectors run through Ostrilo's own `verifyEventSignature`, including the invalid cases with their documented failure reasons. The signing vectors need the vector's `aux_rand`, which Ostrilo's signing functions do not expose; those run against `schnorr.sign` with the supplied auxiliary randomness to confirm byte-exact reproduction, and Ostrilo's own signer is separately checked to produce signatures that verify against the vector public key and message. That split is stated in the file so nobody mistakes the second check for the first.

NIP-01 does not publish an official vector file. Claiming otherwise would be exactly the kind of overstatement this change exists to remove. The NIP-01 vectors are therefore cross-implementation known-answer vectors: events whose `id` and `sig` were produced and independently verified by at least two named external implementations, plus real events retrieved from public relays, each with its source recorded in `provenance.json`. Cross-implementation agreement is the property that matters for interoperability, and it is stronger than anything self-consistency can give.

The four hand-verified serialization edge cases become pinned assertions with their current observed behavior recorded and judged:

- Control characters `U+0001`-`U+001F`: `JSON.stringify` emits `\u00XX`. This diverges from the letter of NIP-01, which lists specific escapes, but matches what deployed implementations do. Pinned, with the divergence noted.
- `U+2028` and `U+2029`: pass through raw. Correct. Pinned so a future serializer swap that escapes them is caught.
- `U+007F`: passes through raw. Correct. Pinned.
- A lone surrogate such as `U+D800`: emitted as `\ud800`. This is the one genuine interoperability divergence, since implementations differ on whether to escape, replace, or reject. Pinned with a comment naming it as a known divergence, so the behavior is a decision rather than an accident.

**Rationale:** Cross-implementation known-answer tests are the cheapest high-value tests available here and the only ones that can catch a wrong-but-consistent implementation. They are also the precondition for `consolidate-crypto-implementations`: merging two crypto paths without vectors means the merge is asserted safe rather than shown safe.

**Alternative considered:** Fetch vectors from the network at test time. Rejected outright - it makes the suite non-hermetic and reintroduces the exact unpinned-network-fetch problem this change is removing elsewhere.

### Decision 6: One named invariant test per real defect

Each defect found in this codebase gets a named test whose failure message says which protection was removed. The named set:

| Invariant | Protects against | Companion change |
|-----------|------------------|------------------|
| `kdf-parameters-pinned` | KDF algorithm or cost silently lowered | `harden-vault-key-derivation` |
| `rng-source-pinned` | Key, salt, IV, or nonce source swapped off the platform CSPRNG | this change |
| `no-unzeroized-key-copy` | A new unzeroized clone of key material | this change |
| `password-not-retained` | Password held on an instance, module variable, or storage | `enforce-password-policy` |
| `password-gate-required` | Reveal or export releasing key material without re-verification | `remove-key-exfiltration-surface` |
| `password-policy-enforced` | Key creation or import accepting a policy-violating password | `enforce-password-policy` |
| `lock-state-fails-closed` | `getLockState` reporting unlocked when the read fails or the state is malformed | `implement-session-auto-lock` |
| `policy-guard-lock` | Deletion of the locked-vault guard in `evaluatePolicy` | `fix-consent-policy-defects` |
| `policy-guard-protected-kind` | Protected kinds `1` and `9734` auto-signing via trust, session grant, or explicit allow | `add-trust-level-policy-system` |
| `policy-guard-deny-precedence` | Explicit deny losing to a session grant | `fix-consent-policy-defects` |
| `policy-fallback-ask` | Unknown origin defaulting to allow | `fix-consent-policy-defects` |

For each row, the change records an observed failure: revert the protection in a scratch working tree, run the test, capture the failure, discard the revert. An invariant test that has never been seen failing is an assumption, and this change is about not shipping those.

Where the companion change has not landed yet, the invariant test is written against the required behavior and the row records that the test is expected to fail until that change ships. That is an honest pending state; a test quietly written to match today's broken behavior is not.

**Rationale:** A fix without a regression test is a fix with a shelf life. The table also gives each companion change a concrete acceptance artifact.

**Alternative considered:** One broad "security posture" suite. Rejected: broad suites produce failure messages that do not name the removed protection, which is most of the value at the moment something breaks.

### Decision 7: One required verification workflow, with E2E deliberately outside it

Add `.github/workflows/verify.yml` alongside the existing `react-doctor.yml`, triggered on `pull_request` and on push to the default branch, with three jobs:

- `verify`: `pnpm install --frozen-lockfile`, `pnpm run compile`, then `pnpm run test`. One Vitest invocation collects `tests/unit`, `tests/integration` and `tests/security`, since `vitest.config.ts` excludes only `tests/e2e`. The granular `test:unit`, `test:integration` and `test:security` scripts remain for local use.
- `build`: `pnpm run build` and `pnpm run build:firefox`.
- `audit`: a dependency vulnerability audit gated at an agreed severity, with the threshold and any accepted exceptions recorded in the repository.

All three are required status checks on the default branch. None uses `continue-on-error`. Node and pnpm come from the `packageManager` field and a pinned setup action, third-party actions are pinned to commit SHAs, and `permissions` is minimal - a workflow with write access is itself an attack surface in a wallet-class repository.

E2E stays out of the required set. The Playwright suite builds the extension, starts a fixture server, and drives a persistent Chromium extension context across 19 spec files with `workers: 1` and `retries: 2` on CI. It runs nightly on a schedule, on `workflow_dispatch`, on pushes to the default branch, and on any pull request carrying a `run-e2e` label. A nightly failure opens an issue, and the suite must be green before a release tag.

**Rationale:** A required check that is flaky teaches contributors to re-run until green and eventually to bypass the gate, which recreates false assurance in a new place. Typecheck, unit, integration, security, builds and audit are fast and deterministic; those are the ones worth blocking on. E2E is where the real user-flow coverage lives, so it must run reliably and often - just not as the thing standing between a correct change and its merge.

**Alternative considered:** Make E2E required from the start. Reconsider once the suite has demonstrated a stable pass rate over a few weeks of nightlies, and promote per-spec rather than wholesale.

### Decision 8: Pin the tooling, keep the trust policy, remove the trust-downgraded edge

Four changes, in this order:

1. Add React Doctor as an exact-version `devDependency` with no range prefix, and change the `doctor` script to invoke `node_modules/.bin/react-doctor`. Remove `@latest` from `package.json` entirely.
2. Reduce both hooks to a single path: run the local binary, or fail. Delete the `pnpm dlx` and `npx --yes` fallbacks from `.git/hooks/pre-commit:15-23` and `.claude/hooks/react-doctor.sh:53-61`, and replace the "command not found; skipping" success path at `.claude/hooks/react-doctor.sh:63-64` with a non-zero exit and the exact install command.
3. Keep `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade` in `pnpm-workspace.yaml` unchanged. They are correct and they are what caught this.
4. Make the pinned version installable under that policy. The refusal is not about React Doctor itself: the untrusted edge is `semver@6.3.1`, reached through `eslint-plugin-react-hooks@7.1.1` and `@babel/core@7.29.7`. The workspace already uses `overrides` for `shell-quote`, `tmp`, `uuid` and `@vitejs/plugin-react`, so adding a reviewed `semver` override pinning a provenance-attested version removes the untrusted edge without relaxing any policy. Prefer that over any per-package trust exception, because an override is a visible, diffable, revocable decision while a trust exception silently disables the check for everything underneath.

If no version of the tool installs under the policy even with a reviewed override, the automatic local hooks are removed and the linter runs only in the `millionco/react-doctor@v2` CI job, where a network fetch happens in a disposable runner rather than on a machine holding signing keys. Losing the local pre-commit signal is a real cost; running unpinned code next to private keys is a larger one.

**Rationale:** A tool that fetches an unpinned dependency tree and executes it after every file edit is an unattended remote-code-execution path on the highest-value machine in the project. The pinning also fixes a second problem: a `100/100` score is only stable against a fixed rule set, so an unpinned tool cannot support a score requirement even in principle.

**Alternative considered:** Set `trustPolicy` to permissive, or add a `semver` trust exception. Rejected. The check fired on a genuine provenance regression in a transitive dependency of a tool we run on a key-holding machine. Turning it off to make a linter run inverts the priority; `minimumReleaseAge: 1440` will also delay a fixed upstream release by a day, which is the intended behavior and not a bug to work around.

### Decision 9: Reword the React Doctor mandate; keep security gates blocking

`AGENTS.md:12` and the corresponding line in `docs/development-standards.md` require `No issues found!` and `100 / 100` before work may be handed off or committed. Reword to: run the pinned local tool after code edits, address findings in the files you changed, do not suppress rules to lower the count, and if the tool cannot run, state the exact command and the reason. Report the score; do not gate on it.

Three reasons. The rule is currently unsatisfiable, and an unsatisfiable rule trains contributors to treat the rulebook as advisory - which is the same false-assurance failure at the level of process. A blocking numeric target creates pressure to silence rules rather than fix causes, which `docs/development-standards.md` already prohibits in the same document that creates the pressure. And `100/100` is not a fixed target across tool versions, so it is only meaningful once the version is pinned.

Typechecking, the unit, integration and security suites, both builds, and the dependency audit stay blocking. Only the code-quality score is relaxed, and the distinction is stated in the instructions so it does not read as a general loosening.

**Rationale:** Gates should be blocking in proportion to what they protect. A React linter score protects maintainability; the security suite protects the user's keys. Treating them identically devalues the second.

**Alternative considered:** Keep the score requirement and add an explicit escape hatch for when the tool cannot run. Rejected: the escape hatch would be used on essentially every turn, which is a rule that exists only on paper.

### Decision 10: Supply-chain gates proportional to a wallet-class project

- **Lockfile integrity.** `--frozen-lockfile` everywhere, including CI and hooks. `packageManager: pnpm@11.5.2` is already declared; CI honors it rather than installing an arbitrary pnpm.
- **Provenance.** Record provenance status when updating `@noble/curves`, `@noble/hashes`, `@scure/base`, `wxt`, `react`, or `react-dom`. A version that loses provenance relative to an earlier release blocks automatic adoption and needs a recorded decision. This is the same signal `trustPolicy: no-downgrade` already enforces at install time; recording it at review time makes the decision visible.
- **Automated updates.** Prefer Renovate over Dependabot, because Renovate honors a minimum-release-age cooldown that can be aligned with the workspace's existing `minimumReleaseAge: 1440`, while Dependabot would propose same-day releases the package manager will then refuse - noisy and confusing. Group routine minor and patch updates; keep cryptographic and extension-runtime dependencies in their own reviewable pull requests. Every update pull request runs the required verification workflow. Dependabot remains the fallback if a hosted app is unacceptable.
- **Reproducible builds.** Record Node, pnpm and WXT versions with each release; set `SOURCE_DATE_EPOCH` so archive timestamps are deterministic; remove build-time timestamps and absolute paths from output; publish artifact checksums with the tag; document the reproduce-and-compare procedure. Vite output is generally deterministic for fixed inputs, so zip metadata is the usual culprit and is where verification effort should go first.

**Rationale:** A user installing a signer from a store cannot audit what they received. A published checksum and a documented reproduce procedure are the difference between trusting the source and trusting the publisher.

**Alternative considered:** Defer reproducible builds until there is a release pipeline. Rejected as a design point but accepted as sequencing: the requirement and the recorded toolchain land now, deep determinism work follows the release pipeline.

### Decision 11: Delete `tests/test-crypto.ts`

The file has no `.test.` or `.spec.` filename infix, so Vitest never collects it; nothing in the repository imports it; it is not a `knip.json` entry; it asserts nothing, logging to the console and returning a boolean; and it attaches itself to `window` under `process.env.NODE_ENV === "development"`. Its content is already covered by `tests/unit/domain/domain-utils.test.ts` and the new vector suites, and the `encryptPrivateKey`/`decryptPrivateKey` functions it exercises are the duplicate implementation that `consolidate-crypto-implementations` will remove. Delete it.

**Rationale:** A file under `tests/` that never runs inflates the apparent size of the suite and will eventually be cited as coverage.

**Alternative considered:** Rename it to `.test.ts` and add assertions. Rejected: that would create a second suite over code slated for removal.

## Risks / Trade-offs

- [Risk] CI time and cost grow from zero to a real number on every pull request; the security suite includes 100,000-iteration PBKDF2 work, and two extension builds are not free. -> Mitigation: run typecheck and all three Vitest suites in one job to share a single install, cache the pnpm store, keep the statistical sample to a fixed byte budget drawn from `generatePrivateKey()` rather than `generateKey()`, and keep E2E off the pull-request path. Measure the wall-clock time of the required set and treat a regression in it as a defect.
- [Risk] Flaky E2E blocking merges pushes contributors toward bypassing gates, recreating false assurance. -> Mitigation: E2E is not a required check; it runs nightly, on demand via label, and before release tags, with nightly failures opening an issue. Promote individual specs to required only after a demonstrated stable pass rate.
- [Risk] Statistical test false failures erode trust in the suite, and a red build nobody believes is worse than no build. -> Mitigation: a 5-sigma threshold with a stated false-failure probability of roughly 6 in 10,000,000, a fixed sample size, the parameters written next to the assertion, and a documented rule that a lone statistical failure is re-run once before being investigated rather than being treated as a real defect.
- [Risk] Vendored vectors go stale, and refreshing them is manual work nobody owns. -> Mitigation: vectors are stored as data with recorded checksums and a documented refresh procedure; BIP-340's file is effectively frozen; the checksum makes drift visible rather than silent. Accepted cost: someone must re-record provenance when a file is refreshed.
- [Risk] Pinning React Doctor means findings from newer rule sets arrive late, and an override on `semver` could mask a genuine advisory. -> Mitigation: Renovate proposes tool updates on the normal cadence; the override names an exact provenance-attested version and is reviewed like any dependency change; the CI job can run a newer version advisorily while the local pinned version stays stable.
- [Risk] Removing `toArrayBuffer` and the `unlock` `passwordBuffer` touches production crypto in a change whose remit is testing. -> Mitigation: both are strictly copy-removing, both are covered by the new buffer-inspection tests plus the existing adapter and key-vault suites, and both are prerequisites for a requirement that would otherwise be unverifiable. If either turns out to be non-trivial, the requirement moves to `harden-vault-key-derivation` and the test lands with a recorded pending status rather than being weakened.
- [Risk] Making the verification workflow a required check will block the remediation programme's own pull requests until the existing suite is green. -> Mitigation: land the workflow non-required first, fix whatever it surfaces, then flip it to required as a separate, deliberate step.
- [Risk] Invariant tests for companion changes that have not shipped will fail on arrival. -> Mitigation: the invariant table records the expected-failure state per row, and those tests are added by the companion change rather than pre-committed red.

## Migration Plan

1. Pin React Doctor, strip every `@latest` invocation, and make both hooks fail loudly. This is first because the rest of the programme is blocked on it.
2. Add the verification workflow as non-required, and fix whatever the existing suite surfaces on a clean runner.
3. Vendor the vectors with provenance and add the known-answer suites. This unblocks `consolidate-crypto-implementations`.
4. Rewrite the zeroization suite against real buffers, and land the two copy-removing fixes it needs.
5. Replace the entropy test with the three-part strategy.
6. Add the invariant tests that apply to already-shipped protections; the remainder arrive with their companion changes.
7. Flip the verification workflow to a required status check.
8. Add the automated dependency updater, the provenance and reproducible-build documentation, and the corrected `docs/TESTING.md` counts.

Rollback is per-step and cheap. Removing the workflow's required status restores today's merge behavior; reverting a test suite restores today's coverage. The only production-code steps are the two copy removals in step 4, each independently revertible. Nothing here changes stored data, so no user-facing migration exists.

## Open Questions

- Which exact React Doctor version installs cleanly under `minimumReleaseAge: 1440` and `trustPolicy: no-downgrade` with a reviewed `semver` override, and if none does, do we accept CI-only linting?
- What severity threshold should fail the dependency audit, and which existing findings, if any, need recorded exceptions on day one?
- Renovate or Dependabot, given Renovate's native release-age cooldown against Dependabot's tighter GitHub advisory integration?
- Which external implementations should produce the NIP-01 cross-implementation vectors, and how many independent agreements are required before an event is accepted as a vector?
- Should the security suite become its own Vitest project so it can be run and reported separately in CI without a second install?
- Does the lone-surrogate divergence warrant a behavior change in `computeEventId`, or only a pinned assertion and a note? That question belongs to `consolidate-crypto-implementations` but the vectors will force the decision.

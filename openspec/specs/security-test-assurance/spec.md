# security-test-assurance Specification

## Purpose

Ensure the security test suite verifies the real behavior of the real implementation, so removing a protection turns a test red instead of passing against a mock.

## Requirements

### Requirement: Security Tests Must Not Mock The Unit Under Test

Tests in `tests/security/` SHALL NOT replace, stub, or spy away the function or module whose behavior the test claims to verify. A security test SHALL observe the real effect of the real implementation, so that it fails when the protection is removed.

#### Scenario: Zeroization suite exercises the real zeroize

- **GIVEN** a test that claims to verify memory zeroization
- **WHEN** the suite runs
- **THEN** it calls the real `zeroize` from `src/domain/utils/crypto.ts`
- **AND** it does NOT install a module mock that replaces `zeroize` with a no-op
- **AND** its assertions are about buffer contents, not about how many times a spy was invoked

#### Scenario: Removing a protection turns the test red

- **GIVEN** a security test that asserts a protection is in place
- **WHEN** the corresponding protection is deliberately removed from `src/`
- **THEN** that test fails
- **AND** the failure message identifies the protection that was removed

### Requirement: Zeroization Is Verified By Inspecting Buffer Contents

Zeroization tests SHALL hold a reference to the underlying byte storage of each sensitive buffer and SHALL assert on the observed bytes after the operation completes. Assertions on call counts alone SHALL NOT be accepted as evidence of zeroization.

#### Scenario: Derived key buffer is observably cleared after unlock

- **GIVEN** a `KeyVaultService` wired to a key-derivation adapter that returns a buffer the test retains a reference to
- **WHEN** `unlock` completes successfully
- **THEN** every byte of the retained derived-key buffer reads zero

#### Scenario: Derived key buffer is observably cleared when decryption fails

- **GIVEN** a `KeyVaultService` whose AEAD adapter rejects during decrypt
- **WHEN** `unlock` rejects
- **THEN** every byte of the retained derived-key buffer reads zero

#### Scenario: Private key buffers are observably cleared on lock

- **GIVEN** an unlocked vault holding one or more decrypted private keys
- **WHEN** `lock` completes
- **THEN** every byte of each previously unlocked private-key buffer reads zero
- **AND** the unlocked key set is empty

#### Scenario: Generated private key is observably cleared even on failure

- **GIVEN** a `KeyVaultService` whose public-key derivation rejects
- **WHEN** `generateKey` rejects
- **THEN** every byte of the generated private-key buffer reads zero

### Requirement: Surviving Copies Of Key Material Are Detected

The security suite SHALL cover every copy of sensitive material that the production code creates and does not clear. Where a copy is unavoidable, the suite SHALL assert that the copy does not outlive the operation that needed it.

#### Scenario: ArrayBuffer copies of key material are covered

- **GIVEN** `toArrayBuffer` in `src/infrastructure/crypto/adapters.ts` clones its input into a fresh `ArrayBuffer`
- **AND** it is called on the raw AES key, on the IV, and on the plaintext
- **WHEN** an encrypt or decrypt operation completes
- **THEN** a test asserts that no cloned buffer containing raw key material or plaintext remains reachable with non-zero contents
- **AND** the test fails if a new unzeroized clone of key material is introduced

#### Scenario: Password buffer copy in unlock is covered

- **GIVEN** `unlock` in `src/application/services/key-vault.service.ts` encodes the password into a `passwordBuffer`
- **WHEN** `unlock` completes or fails
- **THEN** a test asserts every byte of that buffer reads zero
- **AND** a test asserts the service retains no reference to the buffer

### Requirement: String Secrets Have An Honest Testable Guarantee

The specification and the tests SHALL state plainly that a JavaScript string cannot be erased from memory. For string-typed secrets such as the vault password, the asserted property SHALL be that no unnecessary copy is created or retained and that references are dropped as soon as the operation completes, NOT that memory is wiped.

#### Scenario: Password string is not retained on the service

- **GIVEN** a vault password supplied to `unlock`, `generateKey`, `importKey`, or `revealKey`
- **WHEN** the call completes or fails
- **THEN** no property of the service instance holds the password string
- **AND** no module-level or closure-held variable holds the password string
- **AND** the test does NOT claim the password bytes were erased from process memory

#### Scenario: Unnecessary password copies are rejected

- **GIVEN** the production code creates a byte copy of the password
- **WHEN** that copy is not required by the operation it is created for
- **THEN** a test fails and identifies the redundant copy

### Requirement: Key Generation Entropy Is Verified Against The Platform CSPRNG

Tests SHALL prove that generated private keys come from the platform cryptographically secure random number generator. A test that only asserts uniqueness and hex format SHALL NOT be accepted as an entropy test, because a monotonic counter satisfies it.

#### Scenario: Generation draws from crypto.getRandomValues

- **GIVEN** an observer installed on the platform CSPRNG entry point
- **WHEN** a new key is generated
- **THEN** the observer records a request for 32 bytes
- **AND** the generated private key bytes match the bytes the CSPRNG returned

#### Scenario: No fallback generator exists

- **GIVEN** the platform CSPRNG is unavailable
- **WHEN** key generation is attempted
- **THEN** the operation fails with an error
- **AND** no key is produced from `Math.random` or any other non-CSPRNG source

#### Scenario: Counter-style output is rejected

- **GIVEN** the randomness source is replaced with a monotonic counter
- **WHEN** the entropy test runs
- **THEN** the test fails

### Requirement: Statistical Randomness Checks State Their False-Failure Rate

Any statistical test of generated key material SHALL declare, in the test itself, the sample size, the decision threshold, and the resulting false-failure probability. The suite SHALL state that such a check cannot prove randomness quality and exists only as a smoke check against gross breakage.

#### Scenario: Statistical check declares its parameters

- **WHEN** a statistical randomness check runs
- **THEN** the test names the sample size and threshold it uses
- **AND** the expected false-failure rate is recorded next to the assertion
- **AND** the test is documented as a smoke check rather than proof of entropy quality

#### Scenario: Grossly broken generator is caught

- **GIVEN** the randomness source is replaced with a constant byte or a repeating short pattern
- **WHEN** the statistical check runs
- **THEN** the check fails

### Requirement: Test Harness Cannot Weaken Production Crypto

The Vitest setup SHALL only supply a WebCrypto implementation when the runtime lacks one, SHALL NOT substitute a weaker random or hash implementation, and SHALL NOT be reachable from any module under `src/`.

#### Scenario: WebCrypto is only filled in when absent

- **GIVEN** the test runtime already exposes `globalThis.crypto.subtle`
- **WHEN** `vitest.setup.ts` runs
- **THEN** the existing platform crypto is left untouched

#### Scenario: No weak generator substitution

- **WHEN** the test harness configures globals
- **THEN** it installs only Node's `node:crypto` WebCrypto implementation
- **AND** it does NOT install any deterministic, seeded, or `Math.random`-backed generator

#### Scenario: Harness is not importable from production code

- **WHEN** the repository is checked for imports crossing from `src/` into test-only modules
- **THEN** no file under `src/` imports `vitest.setup.ts`, any file under `tests/`, or any test-only crypto shim
- **AND** a test enforces this so a future edit cannot introduce such an import

### Requirement: Stray Test Scripts Are Not Presented As Coverage

Files under `tests/` that no test runner collects SHALL either be converted into collected tests or removed. Test documentation SHALL report counts that match what the runner actually executes.

#### Scenario: Uncollected script is resolved

- **GIVEN** `tests/test-crypto.ts` has no `.test.`/`.spec.` filename infix, is never collected by Vitest, and is imported by nothing in the repository
- **WHEN** this change completes
- **THEN** the file is either a collected test with real assertions or it no longer exists
- **AND** no console-logging development script remains under `tests/` presenting itself as a test

#### Scenario: Documented test counts match the runner

- **WHEN** `docs/TESTING.md` states test and file counts
- **THEN** those counts match the suites Vitest and Playwright actually collect


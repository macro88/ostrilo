# Testing Infrastructure Documentation

## Overview

Ostrilo uses a comprehensive testing strategy with multiple layers of validation to ensure security, reliability, and maintainability. The testing infrastructure is built on **Vitest** for unit and integration testing, and **Playwright** for end-to-end testing.

## Test Coverage Status

The numbers below are what the runners actually collected on 2026-09-13, at the
end of the security-test-assurance work. They are a snapshot, not a contract:
suites are being added continuously, so re-run the commands rather than
trusting a figure in a document.

```bash
pnpm test                     # Vitest: unit + integration + security
npx playwright test --list    # Playwright: E2E inventory, without running it
```

Vitest covers `tests/unit`, `tests/integration` and `tests/security`. Playwright
covers `tests/e2e`, run separately via `pnpm run test:e2e`. Vitest excludes
`tests/e2e/**`, so the two totals never overlap.

Counts are deliberately absent from this document. Run the two commands above:
they take seconds and they cannot be wrong. Every figure previously written
here rotted, twice.

An earlier version of this document claimed "73 passing across 8 test files".
That figure was never reproducible from the runners and had drifted far from
reality; the commands above are now the source of truth.

## Test Structure

```
tests/
├── unit/                    # 28 files, 386 tests
│   ├── application/         # Services: key vault, policy, approvals, profile
│   ├── domain/              # Crypto utilities, NIP-01 events, validation
│   ├── infrastructure/      # Adapters, RPC handlers, schema validation
│   └── ui/                  # Components, hooks, theme, accessibility
├── integration/             # 7 files, 36 tests - cross-layer workflows
├── security/                # 6 files, 133 tests - see below
└── e2e/                     # Playwright, one spec per journey
```

## Test Categories

### Unit Tests (28 files, 386 tests)

Application, domain, infrastructure, and UI layers. Service tests wire real
implementations to an in-memory storage adapter rather than mocking the service
under test.

### Integration Tests (7 files, 36 tests)

Cross-layer workflows: key vault with settings, policy with key vault, the RPC
request path end to end, relay management, and the activity log.

### Security Tests (6 files, 133 tests)

The governing rule for this directory: **a security test must be able to fail
for the right reason**. A test may never mock the unit whose behavior it
claims to verify, and an assertion must observe an effect rather than an
invocation. `expect(zeroizeSpy).toHaveBeenCalled()` is satisfied by a `zeroize`
that does nothing; reading the bytes is not.

**`entropy.test.ts` (20 tests)** - key generation entropy, in three parts of
deliberately different strength, each labelled as such in the file:

- _Known-answer tests._ PBKDF2-HMAC-SHA256 at the shipped parameters
  (c = 100,000, dkLen = 32) against expected values computed once with OpenSSL,
  an implementation independent of the code under test. These are real proofs
  of correctness and carry most of the value.
- _Source assertions._ A spy on `crypto.getRandomValues` proves the private key
  is exactly the bytes the platform returned, and that generation throws rather
  than falling back to any other source when the CSPRNG is unavailable. This is
  what catches a swapped RNG.
- _A statistical smoke check, explicitly bounded._ 4,000 keys drawn from
  `generatePrivateKey()` (128,000 bytes, 1,024,000 bits), a two-sided 5-sigma
  monobit band of 512,000 +/- 2,530, and a two-sided byte-frequency chi-square
  band of [157, 385] at 255 degrees of freedom. Combined false-failure
  probability about 1.1e-6. The file states plainly that this cannot prove
  randomness quality: it detects gross breakage only - a constant byte, a short
  repeating pattern, a stuck bit, or an over-uniform source such as a counter.
  Companion tests feed each of those failure modes in and assert the check goes
  red. A lone statistical failure is re-run once before being investigated.

The case this replaced, "generates cryptographically secure private keys",
generated three keys and asserted only that they differed and were 64 hex
characters. A counter returning 1, 2, 3 passes that.

**`test-seam-safety.test.ts` (10 tests)** - locks down the fact that the test
harness cannot weaken production crypto. It asserts that `vitest.setup.ts`
writes `globalThis.crypto` only inside its missing-subtle guard (the guard
condition is lifted out of the file and evaluated against sentinel globals, so
the shipped guard is what runs), that the harness installs nothing but Node's
WebCrypto, that no deterministic, seeded or `Math.random`-backed generator
appears, and - by scanning every file under `src/` - that production code
cannot import `vitest.setup.ts`, anything under `tests/`, or a test-only crypto
shim.

**`memory-zeroization.test.ts` (13 tests)** - zeroization verified by retaining
the underlying byte storage of each sensitive buffer and reading it after the
operation, on success and failure paths alike.

**`crypto-security.test.ts` (13 tests)** - salt and IV uniqueness, signature
behavior across keys and messages, password handling, lock-state behavior,
input validation, and encryption at rest.

**`policy-invariants.test.ts` (7 tests)** - named regression tests for the
consent and trust policy guards, each with a failure message naming the
protection that was removed.

**`bip340-vectors.test.ts` (70 tests)** - the official BIP-340 Schnorr vector
file from `bitcoin/bips`, run verbatim through Ostrilo's own verification and
signing paths. Known-answer tests from outside this codebase are the only kind
that can catch a wrong-but-consistent implementation.

### E2E Tests

Playwright drives the built extension in a persistent Chromium context, one spec
per user journey. E2E is deliberately not a required merge gate; see `openspec/`
for the rationale.

Every spec runs headless and unattended. Nothing in the suite is skipped: a
journey that cannot be tested gets a spec explaining why, not a `describe.skip`.
Setup goes through `tests/e2e/fixtures/agent.ts` rather than walking onboarding
in each file, so a spec asserts its own journey and not the setup of one.

To drive the extension by hand while writing a spec, see `docs/agent-loop.md`.

## Running Tests

### Basic Test Commands

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run specific test categories
pnpm run test:unit          # Unit tests only
pnpm run test:integration   # Integration tests only
pnpm run test:security      # Security tests only

# Run with coverage
pnpm run test:coverage

# Run coverage with UI
pnpm run test:coverage:ui

# CI/CD ready command
pnpm run test:ci
```

### End-to-End Tests

```bash
# Run extension E2E tests
pnpm run test:e2e

# Run E2E with browser UI
pnpm run test:e2e:headed

# Run the autonomous smoke path with named screenshot artifacts
pnpm run test:e2e:smoke

# Debug E2E tests
pnpm run test:e2e:debug

# E2E test UI mode
pnpm run test:e2e:ui
```

The Playwright harness builds the WXT Chrome extension before tests, starts the
local fixture page on `127.0.0.1:8765`, and loads `.output/chrome-mv3` into a
persistent Chromium extension context. It runs headless by default using
Playwright's bundled Chromium channel. Set `OSTRILO_E2E_HEADED=1` or use
`pnpm run test:e2e:headed` when you need to watch the browser.

The agent smoke test creates a fresh key through the popup UI, captures
extension screens, exercises `window.nostr` from the fixture dApp page, signs a
real event, and verifies the activity log. Named PNG screenshots are written to:

```text
test-results/e2e-screenshots/
```

These screenshots are generated review artifacts rather than committed golden
snapshots. They are suitable for human inspection or multimodal agent
comparison while behavioral assertions keep the test deterministic.

## Test Configuration

### Vitest Configuration

**Performance Optimizations:**

- Test timeout: 10 seconds (for crypto operations)
- Thread pool: 1-4 threads
- Isolated tests: enabled (`isolate: true`), to avoid worker-thread bleed
- Custom path aliases for clean imports

**Coverage Configuration:**

- Provider: V8
- Formats: text, HTML, LCOV
- Thresholds: 80% lines/functions, 70% branches
- Excludes: tests, UI components, configs

**Setup:**

- WebCrypto polyfill for Node.js environment
- Global test utilities available
- Automatic test discovery

### Playwright Configuration

**Browser Support:**

- Chromium extension context (primary automated E2E target)
- Firefox and Safari/WebKit are covered by build validation and lower-level tests

**Extension Testing:**

- Custom persistent Chromium extension fixture
- Automated WXT extension build and loading
- Named screenshot artifacts for autonomous visual review
- Browser context isolation

## Test Patterns and Guidelines

### Unit Test Patterns

**Service Testing:**

```typescript
describe("ServiceName", () => {
  let service: ServiceName;
  let mockStorage: StorageSuite;

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    service = new ServiceName(mockStorage, ...dependencies);
  });

  it("should handle specific behavior", async () => {
    // Arrange
    const input = "test-data";

    // Act
    const result = await service.method(input);

    // Assert
    expect(result).toBeDefined();
    expect(result.property).toBe(expectedValue);
  });
});
```

**Domain Testing:**

```typescript
describe("Utility Function", () => {
  it("should validate input correctly", () => {
    expect(validateInput("valid")).toBe(true);
    expect(validateInput("invalid")).toBe(false);
    expect(() => validateInput(null)).toThrow();
  });
});
```

### Integration Test Patterns

**Cross-Service Testing:**

```typescript
describe("Service Integration", () => {
  let services: { vault: KeyVaultService; policy: PolicyService };

  beforeEach(() => {
    const storage = createMemoryStorage();
    services = {
      vault: new KeyVaultService(storage, ...cryptoAdapters),
      policy: new PolicyService(storage),
    };
  });

  it("should coordinate between services", async () => {
    // Test realistic workflows across services
    const key = await services.vault.generateKey("password", "label");
    await services.policy.setOriginPolicy("origin", { trustLevel: "high" });

    // Verify cross-service state consistency
    const context = await services.policy.loadContext();
    expect(context.unlocked).toBe(false); // Vault initially locked
  });
});
```

### Security Test Patterns

**Cryptographic Testing:**

Uniqueness and format assertions are not security tests - a counter satisfies
both. Assert the source of the material instead, without mocking the function
under test:

```typescript
describe("Crypto Security", () => {
  it("takes the private key from the platform CSPRNG", () => {
    const platform = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const draws: Uint8Array[] = [];
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      ((array) => {
        const filled = platform(array);
        draws.push(new Uint8Array(filled).slice());
        return filled;
      }) as typeof globalThis.crypto.getRandomValues
    );

    const key = generatePrivateKey();

    expect(draws).toHaveLength(1);
    expect(draws[0]).toHaveLength(32);
    expect(Array.from(key)).toEqual(Array.from(draws[0]));
  });
});
```

**Memory Security Testing:**

```typescript
describe("Memory Security", () => {
  it("should clear sensitive data", async () => {
    await vault.unlock("password");
    const signature = await vault.signEvent(unsignedEvent);
    expect(signature).toBeDefined();

    await vault.lock();
    await expect(vault.signEvent(unsignedEvent)).rejects.toThrow();
  });
});
```

## Test Data Management

### In-Memory Storage

Tests use in-memory storage adapters to avoid filesystem dependencies:

```typescript
function createMemoryStorage(): StorageSuite {
  const maps = {
    local: new Map<string, any>(),
    sync: new Map<string, any>(),
    session: new Map<string, any>(),
  };
  // ... implementation
}
```

### Test Isolation

- Each test gets fresh storage instances
- No shared state between tests
- Cryptographic operations use deterministic test data where appropriate
- Random data generation for security-critical tests

## Coverage Requirements

**Minimum Coverage Thresholds:**

- Lines: 80%
- Functions: 80%
- Branches: 70%
- Statements: 80%

**Coverage Exclusions:**

- Test files themselves
- Browser extension entrypoints
- Third-party UI components (shadcn/ui)
- Configuration files

## CI/CD Integration

**Continuous Integration:**

```bash
pnpm run test:ci  # Generates JUnit XML + coverage reports
```

**Coverage Reporting:**

- HTML reports for local development
- LCOV format for CI/CD systems
- Text summary for quick feedback

**Performance Monitoring:**

- Test execution time tracking
- Memory usage monitoring during crypto operations
- Timeout detection for hanging tests

## Security Testing Strategy

### Cryptographic Validation

1. **Entropy Testing**: Verify cryptographic randomness
2. **Key Isolation**: Ensure keys are properly separated
3. **Signature Security**: Validate signature uniqueness and format
4. **Password Security**: Test password handling and storage

### Attack Vector Testing

1. **Input Validation**: Test boundary conditions and invalid inputs
2. **Memory Leaks**: Verify sensitive data clearing
3. **Storage Security**: Ensure proper encryption at rest
4. **Session Management**: Test isolation between sessions

### Security Test Maintenance

- Regular review of threat models
- Update tests when new security features are added
- Benchmark crypto operations for performance regression
- Validate against known attack patterns

## Troubleshooting

### Common Issues

**Test Timeouts:**

- Crypto operations can be slow, configure appropriate timeouts
- Use `{ timeout: 10000 }` for individual slow tests

**WebCrypto Issues:**

- Ensure `vitest.setup.ts` properly configures crypto polyfill
- Use Node.js 18+ for native WebCrypto support

**Import Path Issues:**

- Verify path aliases in `vitest.config.ts`
- Use `@/` prefix for src directory imports

**Memory Issues:**

- Large test suites may need increased Node.js memory
- Use `--max-old-space-size=4096` if needed

### Debugging

**Test Debugging:**

```bash
# Run single test file
npx vitest run tests/unit/specific.test.ts

# Debug with inspect
node --inspect-brk node_modules/vitest/vitest.mjs run

# Use console.log in tests (will show in output)
console.log("Debug info:", variable);
```

**Coverage Debugging:**

```bash
# Generate detailed coverage
pnpm run test:coverage

# Open HTML coverage report
# ./coverage/index.html
```

## Future Improvements

### Planned Enhancements

1. **Performance Testing**: Add benchmark tests for crypto operations
2. **Mutation Testing**: Implement mutation testing for security-critical code
3. **Property-Based Testing**: Add property-based tests for crypto functions
4. **Visual Regression**: Add visual testing for UI components
5. **Load Testing**: Test extension performance under load

### Test Expansion Areas

1. **Error Recovery**: More comprehensive error handling tests
2. **Edge Cases**: Additional boundary condition testing
3. **Browser Compatibility**: Cross-browser crypto testing
4. **Stress Testing**: High-volume operation testing
5. **Security Audit**: External security test validation

---

This testing infrastructure provides comprehensive coverage while maintaining fast feedback loops and ensuring security requirements are met at every layer of the application.

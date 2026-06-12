# Testing Infrastructure Documentation

## Overview

Ostrilo uses a comprehensive testing strategy with multiple layers of validation to ensure security, reliability, and maintainability. The testing infrastructure is built on **Vitest** for unit and integration testing, and **Playwright** for end-to-end testing.

## Test Coverage Status

**Total Tests: 73 passing across 8 test files**

- **Unit Tests**: 50 tests covering application, domain, infrastructure, and UI layers
- **Integration Tests**: 9 tests validating cross-layer service interactions
- **Security Tests**: 14 tests ensuring cryptographic security and attack resistance
- **E2E Tests**: Available via Playwright for browser extension testing

## Test Structure

```
tests/
├── unit/                    # Unit tests (50 tests)
│   ├── application/         # Service layer tests
│   │   ├── keyvault.service.test.ts      # Key management
│   │   ├── policy.service.test.ts        # Policy management
│   │   └── policy.evaluate.test.ts       # Policy evaluation
│   ├── domain/              # Domain logic tests
│   │   └── domain-utils.test.ts          # Utility functions
│   ├── infrastructure/      # Infrastructure tests
│   │   └── adapters.test.ts              # Crypto adapters
│   └── ui/                  # UI component tests
│       └── hooks/
│           └── useOnboarding.test.ts     # React hooks
├── integration/             # Integration tests (9 tests)
│   └── cross-layer.test.ts              # Service integration
├── security/                # Security tests (14 tests)
│   └── crypto-security.test.ts          # Cryptographic security
└── e2e/                     # End-to-end tests (Playwright)
    ├── onboarding-create.spec.ts
    ├── onboarding-import.spec.ts
    └── settings-origin-policy.spec.ts
```

## Test Categories

### Unit Tests (50 tests)

**Application Layer (17 tests)**

- KeyVaultService: Key generation, encryption, signing operations
- PolicyService: Policy management and storage
- Policy Evaluation: Security policy decision logic

**Domain Layer (24 tests)**

- Validation utilities
- Encoding/decoding functions
- Cryptographic utility functions
- Data type transformations

**Infrastructure Layer (3 tests)**

- WebCrypto adapters (AES-GCM, PBKDF2)
- Noble cryptography integration
- Storage adapters

**UI Layer (4 tests)**

- React hooks for onboarding flow
- State management hooks
- Component interaction patterns

### Integration Tests (9 tests)

**Service Integration**

- KeyVault + Settings coordination
- Policy + KeyVault interactions
- Cross-layer data consistency
- Storage layer integration
- Error handling across services

**Workflow Testing**

- Complete user workflows
- Service state management
- Memory and session isolation

### Security Tests (14 tests)

**Cryptographic Security (5 tests)**

- Private key generation entropy
- Unique salt and IV usage
- Signature randomness (non-deterministic)
- Multi-key signature differentiation
- Message differentiation

**Password Security (3 tests)**

- Password validation requirements
- Salt-based protection against rainbow tables
- Weak password handling

**Memory Security (2 tests)**

- Sensitive data clearing on lock
- Session isolation between unlocks

**Input Validation (2 tests)**

- Hash format validation for signing
- Edge case handling in key operations

**Storage Security (2 tests)**

- Encryption at rest verification
- Session storage security

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
- Isolated tests: disabled for speed
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

```typescript
describe("Crypto Security", () => {
  it("should generate unique cryptographic material", async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();

    // Verify uniqueness
    expect(key1.id).not.toBe(key2.id);
    expect(key1.pubkey).not.toBe(key2.pubkey);

    // Verify proper format
    expect(key1.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

**Memory Security Testing:**

```typescript
describe("Memory Security", () => {
  it("should clear sensitive data", async () => {
    await vault.unlock("password");
    const signature = await vault.sign("message");
    expect(signature).toBeDefined();

    await vault.lock();
    await expect(vault.sign("message")).rejects.toThrow();
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

# Testing

Ostrilo is tested with **Vitest** (unit, integration and security suites) and
**Playwright** (end-to-end journeys against the built Chromium extension).

## Current counts

This document carries no test counts, because written counts go stale. Ask the
runners instead:

```bash
pnpm test                             # Vitest: unit + integration + security
pnpm exec playwright test --list      # Playwright: E2E inventory, without running it
```

Vitest covers `tests/unit`, `tests/integration` and `tests/security`, and
excludes `tests/e2e/**`. Playwright covers `tests/e2e`. The two totals never
overlap.

## Test Structure

```
tests/
├── unit/                    # services, domain, infrastructure, UI
│   ├── application/         # Services: key vault, policy, approvals, profile
│   ├── domain/              # Crypto utilities, NIP-01 events, validation
│   ├── infrastructure/      # Adapters, RPC handlers, schema validation
│   └── ui/                  # Components, hooks, theme, accessibility
├── integration/             # cross-layer workflows
├── security/                # see below
└── e2e/                     # Playwright, one spec per journey
```

## Test Categories

### Unit Tests

Application, domain, infrastructure, and UI layers. Service tests wire real
implementations to an in-memory storage adapter rather than mocking the service
under test.

### Integration Tests

Cross-layer workflows: key vault with settings, policy with key vault, the RPC
request path end to end, relay management, and the activity log.

### Security Tests

The governing rule for this directory: **a security test must be able to fail
for the right reason**. A test may never mock the unit whose behavior it
claims to verify, and an assertion must observe an effect rather than an
invocation. `expect(zeroizeSpy).toHaveBeenCalled()` is satisfied by a `zeroize`
that does nothing; reading the bytes is not.

**`entropy.test.ts`** - key generation entropy, in three parts of
deliberately different strength, each labelled as such in the file:

- _Known-answer tests._ PBKDF2-HMAC-SHA256 at the legacy vault's parameters
  (c = 100,000, dkLen = 32) against expected values computed once with OpenSSL,
  an implementation independent of the code under test. New vaults use
  Argon2id; PBKDF2 survives only to read vaults written before that change, and
  these vectors pin that read path.
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

**`test-seam-safety.test.ts`** - locks down the fact that the test
harness cannot weaken production crypto. It asserts that `vitest.setup.ts`
writes `globalThis.crypto` only inside its missing-subtle guard (the guard
condition is lifted out of the file and evaluated against sentinel globals, so
the shipped guard is what runs), that the harness installs nothing but Node's
WebCrypto, that no deterministic, seeded or `Math.random`-backed generator
appears, and - by scanning every file under `src/` - that production code
cannot import `vitest.setup.ts`, anything under `tests/`, or a test-only crypto
shim.

**`memory-zeroization.test.ts`** - zeroization verified by retaining
the underlying byte storage of each sensitive buffer and reading it after the
operation, on success and failure paths alike.

**`crypto-security.test.ts`** - salt and IV uniqueness, signature
behavior across keys and messages, password handling, lock-state behavior,
input validation, and encryption at rest.

**`policy-invariants.test.ts`** - named regression tests for the
consent and trust policy guards, each with a failure message naming the
protection that was removed.

**`bip340-vectors.test.ts`** - the official BIP-340 Schnorr vector
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

The Playwright harness builds the WXT Chrome extension before tests, serves the
fixture page over HTTPS at `https://localhost:8765` (the provider is injected
into `https://` pages only; see `docs/local-https-development.md`), and loads
`.output/chrome-mv3` into a
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

## Configuration

### Vitest

`vitest.config.ts`:

- Node environment, with `vitest.setup.ts` installing Node's WebCrypto only when
  `globalThis.crypto.subtle` is missing. `tests/security/test-seam-safety.test.ts`
  holds that setup to exactly that.
- 10-second test, hook and teardown timeouts, for the key-derivation paths.
- `isolate: true` on a thread pool of up to 4 workers.
- `@/` path aliases into `src/`.

### Coverage

`pnpm run test:coverage` reports V8 coverage of `src/` as text, HTML
(`coverage/index.html`) and LCOV. Extension entry points (`src/extension/`) and
the shadcn primitives (`src/ui/components/ui/`) are excluded.

The configured thresholds are 80% lines, functions and statements and 70%
branches. **The suite does not currently meet them**, so the command exits
non-zero; read the report rather than the exit code. Coverage is not a merge
gate: CI runs `pnpm run test`, not the coverage command. The security suite,
not a percentage, is what protects keys.

### Playwright

`playwright.config.ts` defines the `chromium-extension` project that
`pnpm run test:e2e` runs, and the `agent-scratch` project behind the
`agent:*` scripts. Chromium is the only browser the E2E suite drives. The
Firefox build is checked by `pnpm run build:firefox` and the built-output
assertions in `pnpm run test:build-output`, not by browser tests.

## Writing a security test

Uniqueness and format assertions are not security tests; a counter satisfies
both. Assert the source or the effect, without mocking the function under test:

```typescript
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
```

Service tests wire real services to an in-memory `StorageSuite`; see
`createMemoryStorage` in `tests/integration/cross-layer.test.ts` for the pattern.

## Troubleshooting

- **Timeouts in crypto tests.** Key derivation is deliberately slow. Raise a
  single test's budget with `{ timeout: 20000 }` rather than the global default.
- **Node version.** Use the version in `.nvmrc`; CI pins it.
- **Run one file:** `pnpm exec vitest run tests/unit/specific.test.ts`.
- **Debug with the inspector:** `node --inspect-brk node_modules/vitest/vitest.mjs run`.

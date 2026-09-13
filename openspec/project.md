# Project Context

## Purpose

Ostrilo is a secure browser extension that provides Nostr key management and signing operations. It acts as a NIP-07 compliant signer, enabling web applications to interact with the Nostr protocol without exposing private keys. The extension implements a layered architecture with comprehensive security measures including encrypted storage, policy-based access control, and isolated key operations.

**Key Goals:**
- Provide secure, local-only key management for Nostr identities
- Implement NIP-07 standard with `window.nostr.getPublicKey()` and `signEvent()` methods
- Support multiple keys with per-origin trust policies and permissions
- Maintain zero-trust security: keys never leave the extension context unencrypted
- Support cross-browser deployment (Chrome MV3, Firefox MV2, Safari)

## Tech Stack

### Core Framework & Build Tools
- **pnpm 11.5.2** - Package manager for all local scripts and dependency management
- **WXT 0.20.26** - Web Extension Toolkit for cross-browser development
- **TypeScript 6.0.3** - Type safety and strict compilation
- **React 19.2.7** - UI framework for extension interfaces
- **Vite 7.3.5** - Direct workspace Vite dependency; WXT manages its own internal build pipeline
- **Node.js 24.x in current development environment** - Keep toolchain changes verified against WXT and Playwright

### Cryptography
- **@noble/curves 2.0.0** - secp256k1 schnorr signatures (NIP-01 standard)
- **@noble/hashes 2.0.0** - SHA-256 hashing
- **@scure/base 2.0.0** - bech32 encoding/decoding for nsec/npub keys
- **Web Crypto API** - AES-GCM encryption, PBKDF2 key derivation

### UI & Styling
- **Tailwind CSS 4.3.0** - Utility-first styling framework
- **shadcn/ui** - Radix UI primitives (select, slider, switch, tabs, label)
- **Lucide React 1.17.0** - Icon library
- **class-variance-authority** - Component variant management
- **clsx + tailwind-merge** - Conditional className composition

### Testing Infrastructure
- **Vitest 4.1.8** - Unit and integration testing
- **Playwright 1.60.0** - E2E testing for browser extension workflows
- **@vitest/coverage-v8** - Code coverage reporting

### Validation & Standards
- **Zod 4.4.3** - Runtime schema validation for RPC messages and data
- **webextension-polyfill** - Cross-browser API compatibility

## Project Conventions

### Code Style

**File Naming:**
- React components: PascalCase (e.g., `KeyVaultService.tsx`, `LockScreen.tsx`)
- Utility modules: kebab-case (e.g., `crypto-utils.ts`, `rpc-router.ts`)
- Test files: Match source with `.test.ts` or `.spec.ts` suffix

**Naming Conventions:**
- Interfaces: PascalCase with `I` prefix for ports (e.g., `IStorage`, `ICrypto`)
- Types: PascalCase (e.g., `KeyRecord`, `OriginPolicy`, `RpcRequest`)
- Enums: PascalCase for type, lowercase for values (e.g., `type TrustLevel = "low" | "medium" | "high"`)
- Services: PascalCase with `Service` suffix (e.g., `KeyVaultService`, `PolicyService`)
- RPC handlers: PascalCase with `RpcHandler` suffix (e.g., `VaultRpcHandler`)

**Import Aliases:**
- `@/` - Root of src/
- `@/components/` - UI components
- `@/hooks/` - React hooks
- `@/lib/` - UI utilities
- `@/assets/` - Static assets
- `@/infrastructure/` - Infrastructure layer
- `@/application/` - Application layer
- `@/domain/` - Domain layer

**TypeScript Configuration:**
- Strict mode enabled
- No implicit any
- All code must pass `pnpm run compile` type checking before commit
- UI work must follow `docs/design/DESIGN_RULES.md`; do not reintroduce retired gradients, accent rails, dot-grid backgrounds, Arcade Plush class names, or pink/candy palette choices

### Architecture Patterns

**Hexagonal Architecture (Ports and Adapters)**

Ostrilo strictly follows Hexagonal Architecture principles established by Alistair Cockburn. The architecture creates a clear boundary around the application core, isolating business logic from external technology concerns.

**Layer Structure:**

1. **Domain Layer** (`src/domain/`)
   - Pure business logic and types
   - No dependencies on other layers
   - Contains: `types.ts`, `crypto/`, `policy/`, `utils/`
   - Examples: `KeyRecord`, `OriginPolicy`, policy evaluation logic

2. **Application Layer** (`src/application/`)
   - Orchestrates domain logic and external services
   - Defines ports (interfaces) for external dependencies
   - Contains: `ports/` (IStorage, ICrypto), `services/` (KeyVaultService, PolicyService)
   - Services are the **Driving/Input Ports** of the hexagon

3. **Infrastructure Layer** (`src/infrastructure/`)
   - Implements ports with concrete adapters
   - Handles external technology integration
   - Contains: `crypto/adapters.ts`, `storage/adapters.ts`, `messaging/rpc-router.ts`
   - Adapters are **Driven/Secondary Adapters** that implement port interfaces

4. **UI Layer** (`src/ui/`)
   - React components, hooks, and state management
   - Acts as **Driving/Primary Adapter**
   - Contains: `components/`, `features/`, `hooks/`, `state/`
   - Communicates with application services via RPC in extension context

**Dependency Rules:**
- Domain → (nothing)
- Application → Domain
- Infrastructure → Application + Domain
- UI → Application + Domain (via RPC)

**Dependency Injection:**
Services receive dependencies via constructor injection using port interfaces, enabling easy testing with mocks.

```typescript
// Example: KeyVaultService receives IStorage and ICrypto ports
constructor(
  private readonly storage: IStorage,
  private readonly crypto: ICrypto
) {}
```

**RPC Architecture**

The extension uses a modular RPC system for communication between UI (popup/sidepanel) and background script:

- **RpcRouter** - Routes requests to appropriate domain handlers
- **RpcModule** - Interface all handlers implement
- **ServiceContext** - Dependency injection container
- **Namespaced Handlers** - `vault.*`, `policy.*`, `settings.*`, `crypto.*`, `state.*`

**Adding New RPC Methods:**
1. Add type to `RpcRequest` union in `rpc.ts`
2. Implement in appropriate handler (e.g., `vault-rpc.ts`)
3. Handler validates input and calls application service
4. Return typed `RpcResponse`

### Testing Strategy

**Test Pyramid:**

1. **Unit Tests (50 tests)** - `tests/unit/`
   - Application services (KeyVaultService, PolicyService)
   - Domain utilities (validation, encoding, crypto)
   - Infrastructure adapters (crypto, storage)
   - UI hooks (useOnboarding)
   - Run with: `pnpm run test:unit`

2. **Integration Tests (9 tests)** - `tests/integration/`
   - Cross-service interactions
   - RPC type safety and validation
   - Complete workflow testing
   - Run with: `pnpm run test:integration`

3. **Security Tests (14 tests)** - `tests/security/`
   - Cryptographic security (entropy, salt uniqueness, signature randomness)
   - Memory zeroization
   - Attack resistance (timing, dictionary, brute force)
   - Run with: `pnpm run test:security`

4. **E2E Tests** - `tests/e2e/`
   - Onboarding flows (create, import)
   - Settings and origin policy management
   - Browser extension functionality
   - Current full E2E target runs a Chromium extension project with real WXT build and extension context
   - Run with: `pnpm run test:e2e`

**Testing Requirements:**
- All new features require unit tests
- Security-sensitive code requires dedicated security tests
- E2E tests for user-facing workflows
- Run `pnpm run compile` before committing to catch type errors
- All tests must pass in CI before merge

**Coverage Goals:**
- Unit test coverage tracked with `pnpm run test:coverage`
- Critical paths (crypto, key management) require 100% coverage
- Security functions must have comprehensive test vectors

### Git Workflow

**Branching Strategy:**
- `main` - Production-ready code
- Feature branches for development
- Conventional commit messages recommended

**Pre-Commit Checks:**
1. `pnpm run compile` - TypeScript type checking (REQUIRED)
2. `pnpm test` - Run unit/integration/security tests
3. `pnpm run build && pnpm run build:firefox` - Ensure both browser builds succeed

**Build Validation:**
- Always test both Chrome and Firefox builds when making changes
- Development builds available via `pnpm dev` and `pnpm run dev:firefox`
- Load unpacked extension from `.output/chrome-mv3/` or `.output/firefox-mv3/`

**Important Timeouts:**
- `pnpm install` can take close to a minute - NEVER CANCEL, set timeout to 90+ seconds
- `pnpm run build` takes several seconds - NEVER CANCEL, set timeout to 30+ seconds
- `pnpm run compile` takes a few seconds - Quick validation check

## Domain Context

**Nostr Protocol Knowledge**

Ostrilo implements key management for the Nostr protocol, a decentralized social networking protocol. Understanding these concepts is essential:

**NIPs (Nostr Implementation Possibilities):**
- **NIP-01**: Basic protocol - event structure, signing with schnorr signatures
- **NIP-07**: Browser extension signer interface (`window.nostr.getPublicKey()`, `signEvent()`)
- **NIP-04/44**: Encrypted direct messages (planned support)
- **NIP-19**: bech32-encoded entities (nsec for private keys, npub for public keys)

**Key Concepts:**
- **Private Key**: 32-byte random secret, encoded as `nsec1...` (bech32) or 64-char hex
- **Public Key**: Derived via secp256k1, encoded as `npub1...` or 64-char hex
- **Event**: JSON structure with fields: kind, content, tags, pubkey, created_at, sig
- **Event Kinds**: Numeric identifiers (1=note, 3=contacts, 4=DM, 6=repost, 7=reaction, etc.)
- **Origin**: Web origin (e.g., `https://primal.net`) requesting signing operations

**Security Model:**
- **Zero-trust**: Private keys never leave extension context unencrypted
- **Per-origin policies**: Users control which origins can auto-sign which event kinds
- **Trust levels**: `low` (always prompt), `medium` (auto-sign safe kinds), `high` (auto-sign all)
- **Session grants**: Temporary "allow all" for specific origin during unlock session
- **Lock state**: Extension locked by default, requires password to unlock and access keys

**Multi-Key Support:**
- Users can manage multiple Nostr identities
- Active key selection in header
- Policies apply per-origin, independent of active key
- Each key stored with separate encryption parameters (salt, IV)

## Important Constraints

**Security Constraints:**
- Private keys MUST be encrypted at rest with AES-GCM
- Plaintext keys MUST be zeroized from memory on lock
- No remote code execution - CSP prevents eval, no remote scripts
- Manifest: MV3 on BOTH Chrome and Firefox. Permissions are `storage`, `windows` and `alarms` on both targets, plus `sidePanel` on Chrome only (WXT adds it automatically for the MV3 sidepanel entrypoint). `alarms` is required because a `setTimeout` does not survive MV3 worker eviction, so it is the only way auto-lock can fire at all. An explicit Content Security Policy is declared; see `docs/extension-manifest.md`.
- All crypto operations use audited libraries (@noble/curves, @noble/hashes, Web Crypto API)

**Browser Extension Constraints:**
- Chrome Manifest V3 - service worker background, no persistent background pages
- Firefox Manifest V3 - persistent background scripts supported
- Content Security Policy restrictions apply
- Storage limited to chrome.storage.local API
- Communication between UI and background via message passing only

**Performance Constraints:**
- Background bundle ≤150KB gzipped (currently ~503KB uncompressed)
- Event signing target: ≤5ms median latency
- Build output optimized for extension distribution
- No large runtime dependencies in background script

**Build System Constraints:**
- WXT handles manifest generation and cross-browser builds
- Separate builds required for Chrome and Firefox
- Vite used for bundling, Tailwind for CSS processing
- Path aliases must be configured in both wxt.config.ts and tsconfig.json

**Testing Constraints:**
- Vitest for unit/integration tests (browser environment simulation)
- Playwright requires special fixtures for extension testing
- Crypto operations must use test vectors for validation
- Security tests require proper memory inspection capabilities

## External Dependencies

**Browser APIs:**
- `chrome.storage.local` - Encrypted key and settings persistence
- `chrome.runtime.sendMessage` - RPC communication between contexts
- `chrome.sidePanel` - Side panel UI (Chrome only)
- Web Crypto API - AES-GCM encryption, PBKDF2 key derivation

**Cryptographic Libraries:**
- `@noble/curves/secp256k1` - Schnorr signatures per NIP-01
- `@noble/hashes/sha256` - SHA-256 hashing for event IDs
- `@scure/base` - bech32 encoding for nsec/npub keys
- Web Crypto `subtle.encrypt/decrypt` - AES-GCM for storage encryption

**UI Dependencies:**
- Radix UI primitives - Accessible form controls
- Tailwind CSS - Utility classes compiled at build time
- Lucide React - Icon components

**Development Dependencies:**
- WXT dev server - Hot reload for development
- Playwright browser automation - E2E testing
- Vitest - Test runner with browser environment support

**No External Services:**
- Extension operates entirely offline
- No telemetry or analytics
- No remote relay connections (profile hydration planned as opt-in)
- No external API calls for core functionality

# Architecture Cleanup Implementation Plan

## Executive Summary

This document outlines a comprehensive plan to align the current Ostrilo codebase with the recommended architecture from `CODE_REVIEW.md`. The current structure has some inconsistencies with the proposed clean architecture, mixing concerns across layers and having code scattered in non-optimal locations.

## Current State Analysis

### Structure Comparison

**Current Structure:**
```
├── lib/                     # Mixed utilities & domain logic
│   ├── crypto.ts            # Crypto implementation + interfaces
│   ├── settings.ts          # Types + defaults
│   └── utils.ts             # General utilities
├── hooks/                   # React hooks (UI layer)
│   ├── KeyManagerContext.tsx
│   ├── useAppSettings.ts
│   ├── useKeyManager.ts
│   └── ...
├── src/
│   ├── application/         # ✓ Correct layer
│   │   ├── services/        # ✓ Services implemented
│   │   └── ports/           # ✓ Interfaces defined
│   ├── domain/              # ✓ Correct layer
│   │   ├── types.ts         # ✓ Core types
│   │   └── policy/evaluate.ts # ✓ Pure policy logic
│   └── infrastructure/      # ✓ Correct layer
│       ├── crypto/adapters.ts
│       ├── storage/adapters.ts
│       └── messaging/
├── components/              # React components (UI layer)
├── entrypoints/             # Extension entry points
└── test/                    # Tests (mixed locations)
```

**Recommended Structure:**
```
src/
├── domain/                  # Pure domain logic
│   ├── crypto/              # Crypto interfaces only
│   ├── policy/              # Policy evaluation engine
│   ├── types.ts             # Core domain types
│   └── utils/               # Pure utilities (bech32, encoding)
├── application/             # Application services
│   ├── services/            # Business logic orchestration
│   └── ports/               # Interfaces for infrastructure
├── infrastructure/          # Implementation details
│   ├── storage/             # Storage adapters
│   ├── crypto/              # Crypto implementations
│   └── messaging/           # RPC communication
├── extension/               # Extension-specific code
│   ├── background/          # Background script composition
│   ├── content/             # Content scripts
│   └── provider/            # NIP-07 provider
└── ui/                      # React UI layer
    ├── components/          # UI components
    ├── hooks/               # UI hooks
    └── state/               # UI state stores
```

### Key Issues Identified

1. **Mixed Concerns in `/lib`**: Contains both domain logic and implementation details
2. **UI Layer Scattered**: React hooks and components in different root folders
3. **Direct Crypto Dependencies**: UI components import crypto implementations directly
4. **Settings Type Duplication**: Types defined in multiple places
5. **Test Organization**: Tests scattered across `/test` and `/tests` directories
6. **Direct Storage Access**: UI components access browser storage directly
7. **Missing Abstractions**: No clear separation between crypto interfaces and implementations

## Implementation Plan

### Phase 1: Foundation Cleanup (Low Risk)

#### 1.1 Reorganize Domain Layer
- **Move**: `lib/settings.ts` types → `src/domain/types.ts`
- **Extract**: Crypto interfaces from `lib/crypto.ts` → `src/domain/crypto/`
- **Create**: `src/domain/utils/` for pure utilities (bech32, hex validation)
- **Update**: All imports to reference new locations

**Files Affected:**
```
lib/settings.ts → src/domain/types.ts (merge with existing)
lib/crypto.ts → src/domain/crypto/interfaces.ts + src/infrastructure/crypto/implementations.ts
lib/utils.ts → src/domain/utils/general.ts
```

#### 1.2 Create UI Layer Structure
- **Create**: `src/ui/` directory
- **Move**: `components/` → `src/ui/components/`
- **Move**: `hooks/` → `src/ui/hooks/`
- **Create**: `src/ui/state/` for UI state stores

**Files Affected:**
```
components/ → src/ui/components/
hooks/ → src/ui/hooks/
+ src/ui/state/ (new)
```

#### 1.3 Extension Layer Organization
- **Create**: `src/extension/` directory
- **Move**: `entrypoints/background.ts` → `src/extension/background/index.ts`
- **Move**: `entrypoints/content.ts` → `src/extension/content/index.ts`
- **Create**: `src/extension/provider/` for NIP-07 implementation

**Files Affected:**
```
entrypoints/background.ts → src/extension/background/index.ts
entrypoints/content.ts → src/extension/content/index.ts
+ src/extension/provider/ (new)
```

### Phase 2: Dependency Cleanup (Medium Risk)

#### 2.1 Crypto Layer Separation
- **Extract**: Pure crypto interfaces from `lib/crypto.ts`
- **Move**: Implementations to `src/infrastructure/crypto/`
- **Update**: All imports to use interfaces instead of implementations in UI

**Changes Required:**
```typescript
// Before (in UI components):
import { generateKeyPair, encryptPrivateKey } from "@/lib/crypto";

// After:
import { CryptoService } from "@/src/domain/crypto/interfaces";
// Use via dependency injection or service locator
```

#### 2.2 Settings Service Integration
- **Remove**: Direct settings access from UI hooks
- **Update**: `useAppSettings` to use RPC only
- **Consolidate**: Settings types and defaults

**Files to Update:**
- `hooks/useAppSettings.ts` → `src/ui/hooks/useAppSettings.ts`
- Remove direct storage access
- Use background service exclusively

#### 2.3 Key Management Refactoring
- **Remove**: Direct crypto operations from `useKeyManager`
- **Update**: To use background service RPC calls only
- **Move**: Context to `src/ui/state/`

**Security Improvement:**
- UI layer will never touch plaintext private keys
- All crypto operations handled in background

### Phase 3: Background-First Security (High Risk)

#### 3.1 Remove UI Crypto Access
- **Audit**: All UI components for direct crypto imports
- **Replace**: With RPC calls to background services
- **Ensure**: No plaintext secrets in UI memory

**Critical Changes:**
```typescript
// Remove from UI:
import { decryptPrivateKey, privateKeyToBech32 } from "@/lib/crypto";

// Replace with:
import { signEvent, getPublicKey } from "@/src/infrastructure/messaging/client";
```

#### 3.2 Background Service Composition
- **Update**: Background script to properly compose all services
- **Add**: Service dependency injection
- **Ensure**: All crypto operations happen in background only

#### 3.3 RPC Enhancement
- **Add**: Missing RPC methods for all UI operations
- **Implement**: Proper error handling and validation
- **Add**: Request/response type safety

### Phase 4: Testing Infrastructure (Low Risk)

#### 4.1 Test Organization
- **Consolidate**: `/test` and `/tests` into unified structure
- **Create**: Test utilities and fixtures
- **Add**: Test setup for WebCrypto in Node.js

**New Structure:**
```
tests/
├── unit/
│   ├── domain/              # Domain logic tests
│   ├── infrastructure/      # Adapter tests
│   └── application/         # Service tests
├── integration/             # Cross-layer tests
├── e2e/                     # End-to-end tests
└── fixtures/                # Test data and utilities
```

#### 4.2 Add Missing Tests
- **Domain**: Policy evaluation, crypto utilities, bech32 encoding
- **Infrastructure**: Storage adapters, crypto adapters
- **Application**: Service integration tests

### Phase 5: Final Polish (Low Risk)

#### 5.1 Import Path Standardization
- **Update**: All imports to use consistent path aliases
- **Remove**: Relative imports where possible
- **Add**: Path mapping in `tsconfig.json`

#### 5.2 Linting and Quality
- **Add**: ESLint rules for architecture boundaries
- **Prevent**: UI from importing infrastructure implementations
- **Enforce**: Dependency direction rules

## Detailed Migration Steps

### Step 1: Domain Layer Migration

1. **Create domain structure:**
```bash
mkdir -p src/domain/crypto
mkdir -p src/domain/utils
mkdir -p src/domain/policy
```

2. **Extract crypto interfaces:**
```typescript
// src/domain/crypto/interfaces.ts
export interface CryptoAead {
  encrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  decrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
}

export interface CryptoKdf {
  deriveKey(password: Uint8Array, salt: Uint8Array, params: any): Promise<CryptoKey>;
}

export interface Schnorr {
  getPublicKey(sk: Uint8Array): Promise<Uint8Array>;
  sign(hash32: Uint8Array, sk: Uint8Array): Promise<Uint8Array>;
}
```

3. **Move and merge types:**
```typescript
// src/domain/types.ts (enhanced)
// Merge content from lib/settings.ts and src/domain/types.ts
```

4. **Extract pure utilities:**
```typescript
// src/domain/utils/bech32.ts
// src/domain/utils/encoding.ts
// src/domain/utils/validation.ts
```

### Step 2: UI Layer Organization

1. **Create UI structure:**
```bash
mkdir -p src/ui/components
mkdir -p src/ui/hooks
mkdir -p src/ui/state
```

2. **Move components:**
```bash
mv components/* src/ui/components/
mv hooks/* src/ui/hooks/
```

3. **Update import paths in all files**

### Step 3: Background Security Enforcement

1. **Audit crypto imports in UI:**
```bash
grep -r "from.*lib/crypto" src/ui/ hooks/ components/
```

2. **Replace with RPC calls:**
```typescript
// Before:
const { privateKey } = await decryptPrivateKey(encrypted, password);

// After:
await unlockVault(password); // Background handles decryption
const signature = await signEvent(event); // Background signs
```

3. **Remove crypto dependencies from UI package.json if any**

## Risk Assessment

### Low Risk Changes
- Directory reorganization
- Import path updates
- Test structure cleanup
- Documentation updates

### Medium Risk Changes
- Settings service integration
- RPC method additions
- Background service composition

### High Risk Changes
- Removing crypto access from UI
- Background-first security implementation
- Breaking changes to hook APIs

## Validation Checklist

After each phase, verify:

- [ ] **TypeScript Compilation**: `npm run compile` passes
- [ ] **Build Success**: `npm run build && npm run build:firefox` both succeed
- [ ] **Test Suite**: All existing tests pass
- [ ] **E2E Tests**: Onboarding and core flows work
- [ ] **Security**: No plaintext secrets in UI memory
- [ ] **Performance**: No regression in settings performance
- [ ] **Bundle Size**: No significant increase

## Timeline Estimate

- **Phase 1**: 2-3 days (Foundation cleanup)
- **Phase 2**: 3-4 days (Dependency cleanup)
- **Phase 3**: 4-5 days (Security enforcement)
- **Phase 4**: 2-3 days (Testing infrastructure)
- **Phase 5**: 1-2 days (Polish and documentation)

**Total**: 12-17 development days

## Additional Improvements

### Code Quality Enhancements

1. **Add Architecture Linting Rules:**
```javascript
// .eslintrc.js
rules: {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/infrastructure/**'],
          message: 'UI components should not import infrastructure directly',
          importNames: ['*']
        }
      ]
    }
  ]
}
```

2. **Dependency Injection Container:**
```typescript
// src/extension/background/container.ts
export class ServiceContainer {
  private static instance: ServiceContainer;
  
  constructor(
    private vault: KeyVaultService,
    private policy: PolicyService,
    private settings: SettingsService
  ) {}
  
  // Service locator pattern for RPC handlers
}
```

3. **Type-Safe RPC System:**
```typescript
// Enhanced RPC with better type safety
export interface RpcContract {
  'vault.unlock': { params: { password: string }; result: { selectedKeyId?: string } };
  'vault.sign': { params: { event: NostrEvent }; result: { signature: string } };
  // ... all RPC methods
}
```

## Breaking Changes

### Hook API Changes
- `useKeyManager` will no longer expose crypto functions directly
- `useAppSettings` may have simplified API
- Context providers may be moved to different locations

### Import Path Changes
- All `@/lib/*` imports will need updating
- `@/hooks/*` becomes `@/src/ui/hooks/*`
- `@/components/*` becomes `@/src/ui/components/*`

## Migration Scripts

Consider creating migration scripts for:
- Batch import path updates
- File moves with git history preservation
- Type import consolidation

## Conclusion

This cleanup plan addresses the main architectural inconsistencies while maintaining security and functionality. The phased approach minimizes risk while moving toward the clean architecture outlined in the code review.

Key benefits after completion:
- Clear separation of concerns
- Enhanced security (background-first)
- Better testability
- Consistent import patterns
- Scalable architecture for future features

The plan prioritizes security improvements while maintaining backward compatibility where possible during the transition.

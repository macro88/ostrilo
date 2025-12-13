# Ostrilo - Nostr Signer Browser Extension

Ostrilo is a Nostr protocol signer browser extension built with WXT (Web Extension Toolkit), React, TypeScript, Tailwind CSS, and shadcn/ui components. It provides NIP-07 functionality as a `window.nostr` provider for Nostr applications, enabling secure local signing without exposing private keys.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Bootstrap and Build
- Install dependencies: `npm install` -- takes ~47 seconds. NEVER CANCEL. Set timeout to 90+ seconds.
- TypeScript compile check: `npm run compile` -- takes ~2 seconds.
- Build for Chrome: `npm run build` -- takes ~8 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Build for Firefox: `npm run build:firefox` -- takes ~8 seconds. NEVER CANCEL. Set timeout to 30+ seconds.
- Create zip packages: `npm run zip` and `npm run zip:firefox` -- each takes ~5 seconds.

### Development Workflow
- Start development server: `npm run dev` or `npm run dev:firefox`
  - Creates development builds in `.output/chrome-mv3-dev/` or `.output/firefox-mv2-dev/`
  - Development server may have connection issues but extension builds successfully
  - Extension can be loaded into browser from `.output/` directory for testing
- Post-install setup: `npm run postinstall` (runs automatically via `wxt prepare`)

### Validation and Testing
- **Always run `npm run compile` before making changes** to catch TypeScript errors early.
- **Always build and test both Chrome and Firefox** versions when making changes: `npm run build && npm run build:firefox`
- Manual crypto testing available via `test-crypto.ts` (compile separately for Node.js testing)
- No formal test suite is currently configured - validate changes through build success and manual testing.

## Key Architecture

### Extension Structure
- **Entry Points:**
  - `entrypoints/background.ts` - Service worker for Chrome MV3 / background script for Firefox MV2
  - `entrypoints/content.ts` - Content script injected into web pages to provide `window.nostr`
  - `entrypoints/popup/` - Extension popup UI (16-bit icon click)
  - `entrypoints/sidepanel/` - Chrome side panel UI (enabled in manifest)

### Core Components
- `components/layout/MainApp.tsx` - Main application container (no props accepted)
- `components/layout/` - Core layouts: LockScreen, HomeView, ProfileView, ActivityView, SettingsView
- `components/onboarding/` - First-time setup flows for key import/generation
- `components/ui/` - shadcn/ui components and custom UI elements
- `lib/crypto.ts` - Core cryptographic functions using Noble libraries
- `hooks/useKeyManager.ts` - Key management and encryption state

### Application Services
- `application/services/key-vault.service.ts` - Key management and cryptographic operations
- `application/services/policy.service.ts` - Permission policy evaluation and management
- `application/services/settings.service.ts` - User settings persistence
- `application/services/activity-log.service.ts` - Activity log with ring buffer (50-500 entries)
- `application/services/approval-queue.service.ts` - Pending approval request management

### Build Outputs
- Production: `.output/chrome-mv3/` and `.output/firefox-mv2/`
- Development: `.output/chrome-mv3-dev/` and `.output/firefox-mv2-dev/`
- Zip packages: `.output/ostrilo-0.0.0-chrome.zip` and similar for Firefox
- Bundle size: ~503KB total, main app chunk ~422KB

## Dependencies and Requirements

### Runtime Requirements
- Node.js 20+ (v20.19.5 confirmed working)
- npm 10+ (v10.8.2 confirmed working)

### Core Dependencies
- **WXT 0.20.11**: Web extension build tool and development server
- **React 19.1.1**: UI framework
- **TypeScript 5.9.2**: Type safety and compilation
- **Tailwind CSS 4.1.13**: Styling framework
- **@noble/curves + @noble/hashes**: Cryptographic libraries for Nostr protocol
- **@radix-ui/**: UI primitives for form controls and interactions

### Development Tools Available
- **ESLint 9.35.0**: Available but no configured scripts (run manually: `npx eslint .`)
- **Prettier 3.6.2**: Available but no configured scripts (run manually: `npx prettier --check .`)
- **TypeScript Compiler**: Integrated via `npm run compile`

## Common Tasks and Troubleshooting

### Fixing TypeScript Issues
- MainApp component takes **no props** - remove any `isUnlocked` or similar props
- Use `npm run compile` to catch TypeScript errors before building
- Check `.wxt/tsconfig.json` for generated TypeScript configuration

### Extension Development
- Load unpacked extension from `.output/chrome-mv3/` in Chrome developer mode
- Load temporary add-on from `.output/firefox-mv2/manifest.json` in Firefox
- Development builds include hot reload capabilities and debugging features
- Test crypto functionality by running manual tests in browser console

### Project Structure Quick Reference
```
/
├── entrypoints/           # Extension entry points (background, content, popup, sidepanel)
├── components/           # React components organized by purpose
│   ├── layout/          # Core layouts and MainApp
│   ├── onboarding/      # First-time setup flows  
│   ├── ui/              # shadcn/ui components
│   └── common/          # Shared components
├── lib/                 # Core libraries (crypto, settings, utils)
├── hooks/               # React hooks (useKeyManager, etc.)
├── assets/              # Static assets and Tailwind CSS
├── docs/                # Requirements and design documentation
├── .output/             # Build outputs (git-ignored)
└── .wxt/                # Generated WXT configuration (git-ignored)
```

### Performance and Bundle Analysis
- Main bundle optimized for browser extension environment
- Crypto dependencies properly bundled and optimized
- Warning about dynamic imports is expected and does not affect functionality
- Total build output ~503KB, suitable for extension distribution

## Security and Protocol Implementation

### Cryptographic Standards
- **Noble libraries**: secp256k1 schnorr signatures + SHA-256
- **AES-GCM**: Private key encryption at rest with random salt + IV  
- **Key zeroization**: Overwrite sensitive memory on lock/unload
- **No remote code**: CSP prevents eval, no remote scripts loaded

### Nostr Protocol Support
- **NIP-07**: Primary focus - `window.nostr.getPublicKey()` and `signEvent()`
- **NIP-04/44**: Encrypt/decrypt for direct messages (planned)
- **Multi-key support**: Manage multiple Nostr identities
- **Per-origin permissions**: App-specific approval policies

### Extension Permissions
- `storage`: Local encrypted key storage
- `sidePanel`: Chrome side panel interface
- **No host permissions**: Minimal attack surface
- Content script limited to specific domains for NIP-07 provider

## Validation Requirements

### Before Committing Changes
1. **Always run TypeScript compilation**: `npm run compile`
2. **Build both browser targets**: `npm run build && npm run build:firefox`
3. **Test extension loading** in target browsers when possible
4. **Verify crypto functionality** through manual testing if crypto code changed
5. **Check bundle size** remains reasonable (~500KB total)

### Manual Testing Scenarios
- **Key generation flow**: Create new key, verify backup display, test password setup
- **Key import flow**: Import nsec1/hex format, verify correct public key derivation  
- **Lock/unlock cycle**: Test password-based encryption/decryption of keys
- **Extension UI**: Navigate through all tabs (Home, Profile, Activity, Settings)
- **NIP-07 integration**: Test with compatible Nostr web applications when possible

### Expected Build Times and Timeouts
- `npm install`: ~47 seconds - NEVER CANCEL, set timeout to 90+ seconds
- `npm run compile`: ~2 seconds - Quick TypeScript check
- `npm run build`: ~8 seconds - NEVER CANCEL, set timeout to 30+ seconds  
- `npm run build:firefox`: ~8 seconds - NEVER CANCEL, set timeout to 30+ seconds
- `npm run zip`: ~5 seconds - Package for distribution

## Documentation References

Comprehensive requirements and design specifications available in:
- `docs/ostrilo-signer-requirements.md` - Complete functional requirements matrix
- `docs/ostrilo-onboarding-requirements.md` - First-time setup flow specifications
- `docs/ostrilo-settings-permissions-v1.md` - Permission and settings management

These documents provide detailed acceptance criteria, verification methods, and traceability for all extension features.
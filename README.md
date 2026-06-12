# Ostrilo

A secure browser extension for Nostr key management and signing operations.

## Overview

Ostrilo is a browser extension that provides secure key management for the Nostr protocol. It implements a layered architecture with comprehensive security measures, including encrypted storage, policy-based access control, and isolated key operations.

## Features

- **Secure Key Management**: Generate and import Nostr private keys with AES-GCM encryption
- **Profile Metadata Management**: Fetch, cache, and publish Nostr profiles (NIP-01 kind:0 events) with multi-identity support
- **Policy-Based Security**: Configure per-origin trust levels and signing policies
- **Cross-Browser Support**: Compatible with Chrome, Firefox, and Safari
- **Session Management**: Automatic locking with configurable timeouts
- **Multi-Relay Integration**: Query multiple Nostr relays in parallel for profile data
- **Developer-Friendly**: Clean APIs for integration with Nostr applications

## Architecture

Ostrilo follows a clean architecture pattern with clear separation of concerns:

- **Domain Layer**: Core business logic and types
- **Application Layer**: Services and use cases
- **Infrastructure Layer**: External integrations (crypto, storage)
- **UI Layer**: React components and browser extension interfaces

## Development

### Prerequisites

- Node.js 18+
- pnpm 11+

### Installation

```bash
git clone <repository-url>
cd ostrilo
pnpm install
```

### Development Commands

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Type checking
pnpm compile
```

### Testing

Ostrilo has comprehensive testing infrastructure with 73+ tests covering:

- **Unit Tests**: Service logic, domain utilities, crypto adapters
- **Integration Tests**: Cross-service interactions and workflows
- **Security Tests**: Cryptographic security and attack resistance
- **E2E Tests**: Browser extension functionality

See [Testing Documentation](./docs/TESTING.md) for detailed information.

### Browser Support

- **Chrome/Chromium**: Primary development target
- **Firefox**: Full support with dedicated build
- **Safari**: WebKit compatibility

## Documentation

- [Architecture Primer](./docs/architecture_primer.md) - Project architecture and RPC patterns
- [Product Requirements](./docs/v2-prd.md) - v2 roadmap and requirement matrix
- [Design Rules](./docs/design/DESIGN_RULES.md) - Canonical Inkline UI design system
- [Testing Infrastructure](./docs/TESTING.md) - Comprehensive testing strategy and guidelines
- [Developer Guide](./docs/developers_readme.md) - Contributor-oriented codebase overview
- [RPC Error Codes](./docs/rpc-error-codes.md) - Standardized RPC error reference

## Contributing

1. Follow the established architecture patterns
2. Write comprehensive tests for new features
3. Ensure security considerations are addressed
4. Update documentation as needed

## Security

Ostrilo implements multiple layers of security:

- **Encryption at Rest**: All private keys encrypted with AES-GCM
- **Memory Protection**: Sensitive data cleared on lock
- **Input Validation**: Comprehensive validation of all inputs
- **Policy Enforcement**: Granular permission controls
- **Session Isolation**: Proper isolation between unlock sessions

For security issues, please review our security testing documentation and follow responsible disclosure practices.

## License

[MIT](./LICENSE)

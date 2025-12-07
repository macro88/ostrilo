# Change: Implement NIP-07 Provider

## Why

Ostrilo's core value proposition is enabling Nostr web applications to sign events without exposing private keys. Currently, the content script is a stub and `window.nostr` is not exposed. Without NIP-07 support, users cannot use Ostrilo with any Nostr dApp—this is the critical missing MVP functionality.

## What Changes

- **Content script** (`src/extension/content.ts`): Replace stub with NIP-07 provider that injects `window.nostr` object
- **Injected script**: New script that runs in page context exposing the `window.nostr` API
- **Message bridge**: Content script acts as relay between injected script and background
- **New RPC endpoints**: `nostr.getPublicKey` and `nostr.signEvent` handlers in background
- **WXT config**: Update manifest to inject content script on all URLs (`<all_urls>`)
- **Domain types**: Add `UnsignedEvent` and `SignedEvent` types per NIP-01

## Impact

- **Affected specs**: None existing (this creates the first capability spec)
- **Affected code**:
  - `src/extension/content.ts` - Complete rewrite
  - `src/extension/injected.ts` - New file (page context script)
  - `src/infrastructure/messaging/rpc.ts` - Add new RPC types
  - `src/infrastructure/messaging/handlers/nostr-rpc.ts` - New handler
  - `src/extension/background.ts` - Register nostr handler
  - `wxt.config.ts` - Update content script matches
  - `src/domain/types.ts` - Add Nostr event types

## Security Considerations

- Content script runs in isolated world; cannot access page variables directly
- Injected script runs in page context; communicates via `window.postMessage`
- Background validates all requests; never trusts content/page directly
- Policy evaluation runs before signing; respects user's per-origin rules
- Private keys never leave background context

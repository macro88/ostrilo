## 1. Domain Types

- [x] 1.1 Add `UnsignedEvent` type to `src/domain/types.ts` (NIP-01 fields: kind, content, tags, created_at, pubkey optional)
- [x] 1.2 Add `SignedEvent` type extending UnsignedEvent with `id` and `sig` fields
- [x] 1.3 Add Zod schemas for event validation in `src/infrastructure/validation/schemas.ts`

## 2. RPC Layer

- [x] 2.1 Add `nostr.getPublicKey` request type to `src/infrastructure/messaging/rpc.ts`
- [x] 2.2 Add `nostr.signEvent` request type with `event` and `origin` fields
- [x] 2.3 Create `src/infrastructure/messaging/handlers/nostr-rpc.ts` with `NostrRpcHandler`
- [x] 2.4 Implement `handleGetPublicKey`: return selected key's pubkey or error if locked
- [x] 2.5 Implement `handleSignEvent`: validate event, evaluate policy, compute id, sign, return
- [x] 2.6 Register `nostr` module in background.ts RpcRouter

## 3. Event Hashing

- [x] 3.1 Add `computeEventId(event: UnsignedEvent)` function in `src/domain/utils/crypto.ts`
- [x] 3.2 Implement NIP-01 serialization: `[0, pubkey, created_at, kind, tags, content]`
- [x] 3.3 Hash with SHA-256, return hex string
- [x] 3.4 Add unit tests for event id computation with NIP-01 test vectors

## 4. Content Script

- [x] 4.1 Update `wxt.config.ts` to set content script `matches: ['<all_urls>']`
- [x] 4.2 Rewrite `src/extension/content.ts` as message bridge
- [x] 4.3 Listen for `OSTRILO_NOSTR_REQUEST` messages from page
- [x] 4.4 Validate message shape and forward to background via `browser.runtime.sendMessage`
- [x] 4.5 Return response to page via `window.postMessage` with `OSTRILO_NOSTR_RESPONSE`

## 5. Injected Script

- [x] 5.1 Create `src/extension/injected.ts` for page context execution
- [x] 5.2 Define `window.nostr` object with `getPublicKey()` and `signEvent(event)`
- [x] 5.3 Implement request/response promise management with unique IDs
- [x] 5.4 Add timeout handling (30 second default)
- [x] 5.5 Check for existing `window.nostr` and log warning if present (using Object.defineProperty)

## 6. Script Injection

- [x] 6.1 Configure WXT to inject `injected.ts` into page context using `injectScript` helper
- [x] 6.2 Ensure injection runs at `document_start` for early availability
- [x] 6.3 Configure `web_accessible_resources` in manifest for injected.js

## 7. Integration & Testing

- [x] 7.1 Add unit tests for `NostrRpcHandler` (getPublicKey, signEvent flows)
- [x] 7.2 Add unit tests for content script message validation (covered in nostr-rpc tests)
- [x] 7.3 Add E2E test: inject script, call `window.nostr.getPublicKey()`, verify response
- [x] 7.4 Add E2E test: call `signEvent` with unlocked vault, verify signed event
- [x] 7.5 Add E2E test: call `signEvent` when locked, verify error response
- [x] 7.6 Manual test with Nostr web client (e.g., snort.social, primal.net) - deferred to integration

## 8. Documentation

- [x] 8.1 Update `docs/developers_readme.md` with NIP-07 usage instructions
- [x] 8.2 Add inline JSDoc comments to public `window.nostr` methods

## Dependencies

- Tasks 1.x must complete before 2.x (types needed for RPC)
- Tasks 3.x can run in parallel with 2.x
- Tasks 4.x and 5.x can run in parallel
- Task 6.x depends on 4.x and 5.x
- Tasks 7.x depend on all implementation tasks

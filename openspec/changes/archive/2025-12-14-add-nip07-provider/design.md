## Context

NIP-07 defines how browser extensions provide signing capabilities to Nostr web applications via `window.nostr`. The extension must inject code into the page context while maintaining security boundaries between the untrusted page, isolated content script, and trusted background script.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Page Context (untrusted)                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  window.nostr = {                                        │   │
│  │    getPublicKey() → Promise<string>                      │   │
│  │    signEvent(event) → Promise<SignedEvent>               │   │
│  │  }                                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                    │ postMessage                                │
└────────────────────┼────────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Content Script (isolated world)                                │
│  - Listens for window messages from injected script             │
│  - Forwards valid requests to background via runtime.sendMessage│
│  - Returns responses back to page via postMessage               │
└─────────────────────────────────────────────────────────────────┘
                     │ runtime.sendMessage
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Background Script (trusted)                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  NostrRpcHandler                                         │   │
│  │  - nostr.getPublicKey → vault.getSelectedPublicKey       │   │
│  │  - nostr.signEvent → policy.evaluate + vault.sign        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Message Flow

1. **dApp calls `window.nostr.signEvent(event)`**
2. Injected script generates unique request ID, posts message to content script
3. Content script validates message shape, forwards to background
4. Background evaluates policy for origin + event kind
5. If policy returns `allow`, background computes event hash and signs
6. If policy returns `ask`, background must prompt user (future scope)
7. If policy returns `deny` or `locked`, return error
8. Signed event returned through chain back to dApp

## Goals / Non-Goals

### Goals
- Implement `window.nostr.getPublicKey()` returning hex public key
- Implement `window.nostr.signEvent(event)` returning signed event with id and sig
- Respect existing policy system (per-origin, per-kind rules)
- Support Chrome MV3 and Firefox MV2 via WXT
- Return NIP-07 standard error messages

### Non-Goals
- NIP-04/NIP-44 encryption (separate proposal)
- User prompt UI for `ask` policy (future proposal; for now `ask` → error)
- Relay hints or event relay (application responsibility)
- NIP-46 remote signing (separate proposal)

## Decisions

### Decision 1: Injected Script via `world: 'MAIN'`
WXT supports `world: 'MAIN'` for content scripts in Chrome MV3, which runs code in the page context. For Firefox MV2, we use `executeScript` with `world: 'MAIN'` or fall back to script tag injection.

**Alternatives considered:**
- Script tag injection only: Works but more complex, WXT handles this automatically
- Proxy object in content script: Cannot expose to page context due to isolation

### Decision 2: Event ID computed in background
The event hash (id) is computed in background before signing to ensure integrity. The background validates and normalizes the event before hashing.

**Alternatives considered:**
- Trust page-provided id: Security risk; page could provide arbitrary hash
- Compute in content script: Would require crypto in content script; larger bundle

### Decision 3: Policy `ask` returns error initially
Implementing the approval prompt UI is complex and deserves its own proposal. For MVP, if policy evaluates to `ask`, we return an error prompting the user to adjust their trust settings.

**Alternatives considered:**
- Auto-approve `ask` as `allow`: Security regression
- Block until future implementation: Delays MVP

### Decision 4: Message channel uses `postMessage` with type prefix
Messages between injected script and content script use `window.postMessage` with a unique type prefix (`OSTRILO_NIP07_`) to avoid collision with other extensions or page scripts.

**Alternatives considered:**
- Custom events: Less standardized, same security model
- Direct function calls: Not possible across isolation boundary

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Other extensions conflict on `window.nostr` | Check if already defined; log warning but don't override |
| Page scripts intercept messages | Use unique message prefix; validate message origin |
| Content script injection fails | WXT handles cross-browser differences; add error logging |
| Policy `ask` frustrates users | Clear error message directing to settings; future prompt UI |

## Open Questions

1. ~~Should we expose `getRelays()` method?~~ **Deferred** - Not required for MVP; profile fetch is separate feature
2. ~~Should content script run on `<all_urls>` or subset?~~ **Decision: `<all_urls>`** - Nostr apps can be on any domain

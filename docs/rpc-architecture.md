# RPC Handler Architecture

This document describes the modular RPC handler system implemented to replace the monolithic background script switch statement.

## Overview

The RPC system allows the browser extension's background script to handle requests from the UI in a modular, maintainable way. Instead of a large switch statement with all methods in one place, the system routes requests to domain-specific handlers.

## Architecture

### Core Components

- **RpcRouter** - Central router that delegates requests to appropriate modules
- **RpcModule** - Interface that all handlers must implement
- **ServiceContext** - Dependency injection container for application services
- **RpcHandlers** - Domain-specific handlers for different namespaces

### Flow Diagram

```text
UI Request → RpcRouter → Appropriate Handler → Service Layer → Response
```

## File Structure

```text
src/infrastructure/messaging/
├── rpc-router.ts              # Core router and interfaces
├── rpc.ts                     # Request/response types
└── handlers/
    ├── index.ts               # Handler exports
    ├── vault-rpc.ts           # Vault operations (unlock, lock, etc.)
    ├── policy-rpc.ts          # Policy operations (evaluate, set, etc.)
    ├── settings-rpc.ts        # Settings operations (get, update)
    ├── crypto-rpc.ts          # Crypto utilities (password eval, key parse)
    └── state-rpc.ts           # State operations (getLock)
```

## Adding New RPC Methods

### 1. Add to RPC Types

First, add your new method to the `RpcRequest` union type in `rpc.ts`:

```typescript
export type RpcRequest =
  | { type: "vault.unlock"; password: string }
  // ... existing methods
  | { type: "vault.newMethod"; param: string }; // Add here
```

### 2. Add to Appropriate Handler

Add the method to the relevant handler (or create a new handler if needed):

```typescript
// In vault-rpc.ts
async handleRequest(message: RpcRequest, context: ServiceContext): Promise<RpcResponse> {
  switch (message.type) {
    case "vault.unlock":
      return this.handleUnlock(message, context);
    
    case "vault.newMethod": // Add here
      return this.handleNewMethod(message, context);
    
    default:
      return { ok: false, error: `unsupported_method: ${(message as any).type}` };
  }
}

private async handleNewMethod(
  message: Extract<RpcRequest, { type: "vault.newMethod" }>,
  context: ServiceContext
): Promise<RpcResponse> {
  // Implementation here
  const result = await context.vault.someMethod(message.param);
  return { ok: true, data: result };
}
```

## Privilege boundary: page-reachable vs UI-only

Namespaces are split in two, and the split is enforced in
`createRpcMessageListener` **before** any handler or service is touched.

| Class | Namespaces | Reachable from |
|---|---|---|
| Page-reachable | `nostr` | a web page, via the content script |
| UI-only | `vault`, `keys`, `crypto`, `policy`, `settings`, `state`, `approval`, `activity`, `profile` | the extension's own pages only |

Unknown namespaces default to **UI-only**. Adding a namespace does not
accidentally expose it to the web.

### The sender rule

For a UI-only namespace the sender must satisfy BOTH:

- `sender.id === browser.runtime.id`, and
- `sender.url` starts with `browser.runtime.getURL("/")`.

Note what is deliberately **not** used: `sender.tab`. The options page is
`options_ui.open_in_tab: true` and the approval window is created with
`browser.windows.create`, so both are extension pages that carry a
`sender.tab`; requiring its absence would break them. And `sender.id` alone is
insufficient, because this extension's own content script also reports
`sender.id === browser.runtime.id`. The sender's URL is the usable signal.

A rejected sender gets `unknown_namespace` - the same response an unregistered
namespace gets - so a caller that is not allowed here learns nothing about what
exists.

This is defence in depth. The content script already builds its own request
objects and forwards exactly two methods, so a page cannot name an arbitrary
RPC type today. But that allowlist lives in a different file from the thing it
protects, and anyone adding a third forwarded method would inherit the whole
privileged surface.

### Page origin binding

A `nostr` request carries the `origin` the content script read from
`window.location.origin`. The background does not take that on trust: every
per-origin decision - consent, trust level, rate limit, the origin the approval
window shows - would otherwise rest on a value any code in the content-script
process can write.

`attestPageOrigin` (`src/infrastructure/messaging/sender-trust.ts`) runs in the
listener, before the lock gate, and derives the origin from the
browser-attested sender. The sender must:

- report `sender.id === browser.runtime.id` (this extension's content script),
- carry a `sender.tab` with `sender.frameId === 0` (the content script is
  top-frame only),
- have an `https:` `sender.url`, and
- where the browser supplies `sender.origin` (Chromium; Firefox does not),
  agree with that URL's origin.

The derived origin must then equal the claimed `message.origin`. On success the
listener overwrites `message.origin` with the derived value, so handlers only
ever see what the browser vouched for. Any failure is `invalid_origin`, with no
handler called, no rate limit charged and no locked-page marker raised.

A mismatch is refused rather than silently corrected: the content script and
the browser disagreeing about where a request came from means a navigation race
or a tampered process. Same-document navigations (`pushState`, hash changes)
keep the origin, so SPA routing is unaffected.

### Commands outside the router

`ostrilo.openApprovalWindow` is handled by a second `onMessage` listener
(`approval-window-command.ts`), not by the router. It applies the same
extension-page sender rule as a UI-only namespace and ignores anything else.

### One throttle for every password check

Every handler that verifies the master password - `vault.unlock`,
`requireReauth`, `vault.reveal`, and `vault.generate` / `vault.import` against
an existing vault - runs the check through `withPasswordThrottle`
(`password-throttle.ts`). The throttle is consulted before any derivation, a
wrong password is charged to one shared counter, and a verified password resets
it on any path. Creating the first vault verifies nothing and is not charged.

### Methods that deliberately do not exist

- **`vault.export`** - returned the raw nsec whenever the vault was unlocked,
  with no password, no consent and no activity-log entry. Removed. Use
  `vault.reveal`, which re-verifies the password before releasing anything.
- **`vault.sign`** - signed any 32-byte value with no origin, no policy
  evaluation and no approval. Removed. Signing goes through
  `nostr.signEvent`, which forces the pubkey to the selected key, recomputes
  the event id rather than trusting a caller-supplied one, and evaluates
  policy first.

### Logging policy

Log the method name and the status or machine error code. **Never log a
request payload or a response body.** `vault.reveal` returns an nsec;
`crypto.parsePrivateKey` used to return raw key bytes. A single
`console.log(res)` in the RPC client was enough to write a private key into the
page console, where it stayed for the life of the document.

Error responses carry a fixed `details` string. Thrown error text can contain
internal paths and state, and the response travels back toward the caller.

### 3. Register Handler (if new namespace)

If creating a new namespace, register it in `background.ts`:

```typescript
router.registerModule("newnamespace", new NewRpcHandler());
```

## Error Handling

The router and handlers use standardized error codes for predictable error handling. All error codes are defined in `src/infrastructure/messaging/error-codes.ts`.

### Error Response Format

```typescript
{
  ok: false,
  error: string,      // Standard error code from RPC_ERROR_CODES
  details?: string    // Optional diagnostic information
}
```

### Common Error Codes

- **Unknown namespace**: Returns `RPC_ERROR_CODES.UNKNOWN_NAMESPACE` when namespace not registered
- **Invalid message**: Returns `RPC_ERROR_CODES.INVALID_REQUEST` for malformed messages
- **Unknown method**: Returns `RPC_ERROR_CODES.UNKNOWN_METHOD` when handler doesn't support method
- **Locked vault**: Returns `RPC_ERROR_CODES.LOCKED` when operation requires unlocked vault
- **Validation failures**: Returns specific codes like `INVALID_EVENT`, `INVALID_ORIGIN`, `INVALID_PASSWORD`, etc.

### Using Error Codes

```typescript
import { RPC_ERROR_CODES } from '@/infrastructure/messaging/error-codes';

// In handler
if (!isValid(input)) {
  return {
    ok: false,
    error: RPC_ERROR_CODES.INVALID_REQUEST,
    details: "Input validation failed"
  };
}
```

For complete error code reference, see [RPC Error Codes documentation](./rpc-error-codes.md).

## Testing

Each handler can be unit tested independently:

```typescript
const handler = new VaultRpcHandler();
const mockContext = { vault: { unlock: vi.fn() } } as any;
const message = { type: "vault.unlock", password: "test" };

const result = await handler.handleRequest(message, mockContext);
expect(result).toEqual({ ok: true, data: expectedData });
```

## Benefits

- **Maintainability**: Each handler focuses on one domain
- **Testability**: Handlers can be tested in isolation
- **Scalability**: Easy to add new methods without growing monolithic code
- **Type Safety**: Full TypeScript support with request/response types
- **Separation of Concerns**: Clear boundaries between different functional areas

## Migration Notes

The refactoring maintains 100% API compatibility. All existing RPC methods work exactly the same way from the client perspective. Only the internal organization has changed for better maintainability.

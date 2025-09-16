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

### 3. Register Handler (if new namespace)

If creating a new namespace, register it in `background.ts`:

```typescript
router.registerModule("newnamespace", new NewRpcHandler());
```

## Error Handling

The router provides centralized error handling:

- **Unknown namespace**: Returns `{ ok: false, error: "unknown_namespace: X" }`
- **Invalid message**: Returns `{ ok: false, error: "invalid_message_type" }`  
- **Handler errors**: Returns `{ ok: false, error: error.message }`

Individual handlers should also validate inputs and return appropriate error responses.

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

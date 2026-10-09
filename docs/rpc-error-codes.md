# RPC Error Codes

Every failure in the Ostrilo RPC layer carries a canonical error code. The codes are defined once, in `src/infrastructure/messaging/error-codes.ts` (`RPC_ERROR_CODES`), and nothing else is a valid code: handlers, the router and the content script all draw from that object. Tests compare against the constants, and `tests/unit/infrastructure/error-code-coverage.test.ts` fails if a handler or `content.ts` hard-codes an error string, or if the table below drifts from the code.

## Response shape

An RPC response is one of:

```typescript
{ ok: true; data: unknown }
{ ok: false; error: RpcErrorObject }

type RpcErrorObject = {
  code: number;          // numeric code, from RPC_NUMERIC_ERROR_CODES
  message: string;       // default text, from RPC_ERROR_MESSAGES, unless overridden
  data: {
    errorCode: RpcErrorCode; // the canonical string, for example "locked"
    details?: string;        // short diagnostic text; never a secret
    debug?: unknown;
    method?: string;         // the request type that failed, for example "nostr.signEvent"
  };
};
```

Build one with `createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, { details, method })`. Read the code back with `getRpcErrorCode(error)` or `error.data.errorCode`. Branch on `data.errorCode`, never on `message`.

## What a web page receives

A page never sees an `RpcErrorObject`. The content script (`src/extension/content.ts`) reduces a failed response to its `data.errorCode` string and posts only that to the page. The injected provider rejects the `window.nostr` promise with `new Error(errorCode)`, so `error.message` is exactly one of the codes below:

```javascript
try {
  const signed = await window.nostr.signEvent(event);
} catch (error) {
  switch (error.message) {
    case "locked":             // the vault is locked; a retry after unlocking can succeed
    case "denied":             // refused for this request
    case "disclosure_refused": // refused for this site's identity; do not retry in a loop
    case "timeout":            // nobody answered the approval in time
    case "approval_failed":    // the request did not complete; retry
    case "invalid_event":      // the event was missing or malformed
      break;
  }
}
```

`details`, `method`, `debug` and the numeric `code` stay inside the extension. The content script also never forwards an exception message, the browser's own wording for a failed `runtime.sendMessage`, or a code it does not recognise.

The content script answers these itself, without asking the background:

| Situation | Page receives |
|-----------|---------------|
| `signEvent` sent with no event object | `invalid_event` |
| A method other than `getPublicKey` or `signEvent` | `unknown_method` |
| `runtime.sendMessage` rejects: the background was ended while the request was open, or the extension was reloaded under the page | `approval_failed` |
| The background replied with something that is not a well-formed response, or a failure carrying a code this build does not define | `approval_failed` |

A retry after `approval_failed` reports whether the vault is locked. The page-side deadline in `injected.ts` also rejects with `timeout`.

## Error code table

"Page" marks the codes a `window.nostr` call can reject with. The others stay between extension pages and the background.

| Code | Numeric | Default message | Page |
|------|---------|-----------------|------|
| `invalid_request` | -32600 | Invalid request | no |
| `unknown_method` | -32601 | Unknown method | yes |
| `unknown_namespace` | -32601 | Unknown namespace | no |
| `invalid_params` | -32602 | Invalid parameters | no |
| `invalid_event` | -32602 | Invalid event | yes |
| `invalid_origin` | -32602 | Invalid origin | yes |
| `invalid_password` | -32602 | Invalid password | no |
| `invalid_key_input` | -32602 | Invalid key input | no |
| `invalid_hash` | -32602 | Invalid hash | yes |
| `vault_unreadable` | -32005 | Vault cannot be read | yes |
| `locked` | -32001 | Vault is locked | yes |
| `needs_approval` | -32002 | Approval required | yes |
| `denied` | -32003 | Operation denied | yes |
| `timeout` | -32004 | Request timed out | yes |
| `disclosure_refused` | -32006 | Identity disclosure refused for this site | yes |
| `no_key_selected` | -32011 | No key selected | yes |
| `key_already_exists` | -32012 | Key already exists | no |
| `key_not_found` | -32013 | Key not found | no |
| `vault_migration_pending` | -32014 | Vault migration pending | no |
| `vault_records_damaged` | -32015 | Vault has damaged key records | no |
| `rate_limited` | -32020 | Rate limited | yes |
| `network_error` | -32030 | Network error | no |
| `approval_failed` | -32040 | Approval failed | yes |
| `signing_failed` | -32041 | Signing failed | yes |

## When each code is used

### Authorization

- `locked`: the operation needs the keys and the vault is locked. This includes a request whose approval prompt was open when the vault locked: the page hears `locked`, not `denied` or `disclosure_refused`, so it can ask again after an unlock. A page request refused while locked also raises the toolbar badge; it does not open the unlock popup.
- `denied`: policy or the user refused this operation. Distinct from `disclosure_refused`: a refused signature is about one event, so a different event is a reasonable retry.
- `disclosure_refused`: the user refused to disclose the public key to this origin, or a refusal is remembered for it and no prompt is shown. Retrying only burns the origin's rate allowance.
- `needs_approval`: the request needs the user's approval and no approval queue is available.
- `rate_limited`: a method or origin exceeded its rate limit. `getPublicKey` is limited per origin, so a caller that polls sees this rather than a key.

### Validation

- `invalid_event`: the event is missing, not an object, or fails schema validation.
- `invalid_origin`: the origin is malformed, or the browser cannot attest it. The router refuses a `nostr.*` request whose claimed `origin` disagrees with the origin of `sender.url`, or whose sender is not this extension's top-frame content script on an `https:` page. See "Page origin binding" in `rpc-architecture.md`.
- `invalid_hash`: an event id is not 32 bytes of hex.
- `invalid_password`: a password fails the creation policy, or a master-password check fails (the current password given to `vault.changePassword` is wrong, charged to the unlock throttle).
- `invalid_key_input`: a private key is not valid `nsec1` or 64-character hex.
- `invalid_request`: the message is not an object with a `type`.
- `invalid_params`: a request's parameters fail method-level validation.

### State

- `no_key_selected`: the operation needs an active key and none is selected.
- `key_already_exists`: the key being imported is already in the vault, or `vault.generate` was sent with `onlyIfEmpty` and the vault already holds a key (nothing is created).
- `key_not_found`: the key id is not in the vault.
- `vault_unreadable`: the vault, or the selected key, cannot be read: an unknown format version, KDF parameters below the accepted floor, or an unreadable key record. Distinct from `invalid_password`, so a damaged vault never tells the user their password is wrong.
- `vault_migration_pending`: `vault.changePassword` found a key record still in the pre-envelope format. Nothing is written; one unlock migrates it.
- `vault_records_damaged`: `vault.changePassword` found key records that do not open under the current password. Nothing is written, and `details` names the affected key ids, never a password.

### Operation

- `timeout`: an approval request was not answered within its time limit.
- `approval_failed`: the approval path failed, or the request did not complete. The content script uses it when the background cannot answer.
- `signing_failed`: the signing operation itself failed.
- `unknown_method`: the request type is not supported by its handler. The router also returns it, with fixed `details`, when a handler throws, so a raw exception message never reaches the wire.
- `unknown_namespace`: no module is registered for the type's namespace. A privileged namespace requested by an untrusted sender gets the same response, so that caller learns nothing about what exists.
- `network_error`: a network dependency (a relay) failed or was unreachable.

## Using the codes in code

```typescript
import { RPC_ERROR_CODES, createRpcErrorResponse } from "@/infrastructure/messaging/error-codes";

if (!context.vault.isUnlocked()) {
  return createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, { method: message.type });
}
```

In tests, compare against the constants and the structured response:

```typescript
expect(response).toEqual(
  createRpcErrorResponse(RPC_ERROR_CODES.LOCKED, { method: "nostr.signEvent" })
);
```

Do not match on message text.

### Security considerations

- Never put a password, private key, internal path, or raw exception message in `details`. Where a service error is translated, use a fixed string.
- Use the generic codes (`denied`, `locked`) rather than revealing internal policy logic.
- Whatever crosses to a page is only the code string, so adding a code is adding a word to the public provider contract. Record it in `openspec/specs/rpc-error-codes/spec.md`.

## See also

- [RPC Architecture](./rpc-architecture.md) - the router, privilege boundary and page origin binding
- [Testing Guide](./TESTING.md) - how to test RPC error conditions
- [NIP-07 Provider](../openspec/specs/nip07-provider/spec.md) - NIP-07 specific error scenarios

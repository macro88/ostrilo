## Why

Ostrilo's product promise is that a private key never leaves the extension. Two RPC methods break that promise on the message bus. `vault.export` returns the raw `nsec` and hex private key to any caller that reaches the router, with no password, no consent prompt, and no activity-log entry. `vault.sign` returns a Schnorr signature over any caller-supplied 32-byte hash, with no origin, no policy evaluation, no approval, and no record. Neither method has a single caller anywhere in the codebase. The RPC client then logs every response body, so the one supported backup path prints the `nsec` in cleartext to the console, and console output is not stripped from production builds.

Nothing exploits this today. A hostile web page can only reach `nostr.getPublicKey` and `nostr.signEvent`, because the content script forwards exactly those two methods, and no co-installed extension can reach the router at all. The problem is the surface itself: dead code with the highest possible payoff, sitting one message behind anything that runs inside an Ostrilo extension page, while the popup, sidepanel, options, and approval bundles pull in three.js, the Radix set, lucide-react, and qrcode.react. This change deletes the surface, then adds the privilege boundary and logging discipline that should have been protecting it.

## What Changes

- **BREAKING** Remove `vault.export`: the `RpcRequest` variant, the `VaultRpcHandler` case, `KeyVaultService.exportKey()`, and the unused `exportKey()` client wrapper. `vault.reveal` remains the only path to private-key material and it re-verifies the password.
- **BREAKING** Remove `vault.sign`: the `RpcRequest` variant, the `VaultRpcHandler` case, and the unused `signHash()` client wrapper. `KeyVaultService.sign()` stays because `nostr.signEvent` calls it after policy evaluation and approval.
- Split the RPC surface into a page-reachable namespace set (`nostr`) and a UI-only namespace set (`vault`, `keys`, `policy`, `settings`, `crypto`, `state`, `approval`, `activity`, `profile`), and enforce the split in the message listener using the `sender` argument it currently ignores.
- Replace the raw secret-key byte array returned by `crypto.parsePrivateKey` with a validation-only result, and stop accepting `npub` input for a private-key parser.
- Remove the RPC response-body log from the messaging client and adopt a logging policy for the signer: method name and outcome status only, never an RPC envelope, payload, or response body.
- Strip `console` and `debugger` from production builds through the WXT Vite config.
- Dispatch router namespaces through a null-prototype map so `__proto__` and `constructor` cannot reach the module lookup, and stop forwarding raw internal error text as RPC `error.data.details`.

Out of scope: no changes to the NIP-07 approval or policy flow, no new backup or export feature, no manifest permission changes, and no removal of `vault.reveal`.

## Capabilities

### New Capabilities

- `rpc-privilege-boundary`: Which RPC namespaces are reachable from page-injected content scripts versus extension UI pages, how the background verifies the caller, and how namespace dispatch resists prototype-chain keys.
- `secret-log-hygiene`: What the extension is permitted to log, and the guarantee that production builds carry no console output.

### Modified Capabilities

- `key-vault`: Add the requirement that private-key material only leaves the vault after password re-verification, and remove the passwordless export behavior that contradicts it.
- `rpc-validation`: Extend `Strict Input Validation` so namespace resolution rejects prototype-chain keys and error responses no longer carry raw internal error text.

## Impact

- RPC contract: `src/infrastructure/messaging/rpc.ts` loses the `vault.export` and `vault.sign` variants and changes the `crypto.parsePrivateKey` response shape.
- RPC handlers: `vault-rpc.ts` loses `handleSign` and `handleExport`; `crypto-rpc.ts` returns a validation result instead of key bytes.
- Router: `rpc-router.ts` needs namespace classification, sender verification, a null-prototype module map, and sanitized error details.
- Application service: `KeyVaultService.exportKey()` is deleted; `revealKey()` and `sign()` are unchanged.
- Messaging client: `client.ts` loses the response-body log, the `exportKey()` wrapper, and the `signHash()` wrapper; `parsePrivateKey()` returns a validation result.
- UI: `OnboardingImportKey` and `ImportKeyForm` call `parsePrivateKey` only to validate input, so both adapt to a boolean-style result with no behavior change.
- Build: `wxt.config.ts` gains `esbuild: { drop: ["console", "debugger"] }`. The `harden-manifest-and-build` change also edits this file, so the two changes must be sequenced or merged by hand.
- Tests: `tests/unit/infrastructure/rpc-client.test.ts` and `tests/unit/infrastructure/rpc-validation.test.ts` reference `vault.export` and `vault.sign` and must move to surviving methods; `rpc-handlers.test.ts` asserts the `crypto.parsePrivateKey` byte-array shape.
- PRD: `docs/v2-prd.md` needs a security requirement covering RPC privilege separation and production log stripping, which no current SEC row states.

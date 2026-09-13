## 1. Prove The Removed Surface Has No Consumers

- [ ] 1.1 Grep `src/` and `tests/` for `vault.export`, `exportKey`, `vault.sign`, and `signHash` and record every hit so the removal is evidence-based, not assumed.
- [ ] 1.2 Confirm the only `exportKey` hits are the service definition, the `RpcRequest` variant, the `VaultRpcHandler` case, the unused client wrapper, and `tests/unit/infrastructure/rpc-client.test.ts`, which uses the string `vault.export` as an arbitrary method name.
- [ ] 1.3 Confirm the only `signHash` client-export hit is the definition in `client.ts`, and that the same name in `src/domain/utils/crypto.ts` is an unrelated domain function that must stay.
- [ ] 1.4 Confirm `KeyVaultService.sign()` has a real caller in `nostr-rpc.ts` so it is kept while the `vault.sign` RPC method is removed.

## 2. Remove Passwordless Export

- [ ] 2.1 Delete the `vault.export` variant from the `RpcRequest` union in `src/infrastructure/messaging/rpc.ts`.
- [ ] 2.2 Delete the `vault.export` switch case and `handleExport` from `src/infrastructure/messaging/handlers/vault-rpc.ts`.
- [ ] 2.3 Delete `KeyVaultService.exportKey()` from `src/application/services/key-vault.service.ts` and leave `revealKey()` unchanged.
- [ ] 2.4 Delete the `exportKey()` wrapper from `src/infrastructure/messaging/client.ts`.
- [ ] 2.5 Update the `VaultRpcHandler` doc comment so the handled-method list no longer advertises `vault.export`.

## 3. Remove The Blind Signing Oracle

- [ ] 3.1 Delete the `vault.sign` variant from the `RpcRequest` union in `src/infrastructure/messaging/rpc.ts`.
- [ ] 3.2 Delete the `vault.sign` switch case and `handleSign` from `src/infrastructure/messaging/handlers/vault-rpc.ts`.
- [ ] 3.3 Delete the `signHash()` wrapper from `src/infrastructure/messaging/client.ts`.
- [ ] 3.4 Update the `VaultRpcHandler` doc comment so the handled-method list no longer advertises `vault.sign`.
- [ ] 3.5 Confirm `HashHexSchema` still has a consumer after the removal, and remove the import from `vault-rpc.ts` if it does not.

## 4. Stop Returning Secret Bytes From Key Parsing

- [ ] 4.1 Change `crypto.parsePrivateKey` in `src/infrastructure/messaging/handlers/crypto-rpc.ts` to return a validation verdict instead of `Array.from(privateKey)`.
- [ ] 4.2 Validate the input against a private-key-only schema so `npub1...` is rejected with `invalid_key_input`.
- [ ] 4.3 Update the `crypto.parsePrivateKey` response type in `src/infrastructure/messaging/rpc.ts` and the `parsePrivateKey()` return type in `src/infrastructure/messaging/client.ts`.
- [ ] 4.4 Update `src/ui/features/onboarding/components/OnboardingImportKey.tsx` so `parsedKeyRef` holds a boolean validity flag instead of a `Uint8Array`.
- [ ] 4.5 Confirm `src/ui/components/dialogs/ImportKeyForm.tsx` still works unchanged, since it discards the result already.

## 5. Router Privilege Boundary

- [ ] 5.1 Change `RpcRouter.modules` in `src/infrastructure/messaging/rpc-router.ts` to a `Map`, and update `registerModule` and `getRegisteredNamespaces` accordingly.
- [ ] 5.2 Declare the page-reachable namespace set (`nostr`) and treat every other registered namespace as UI-only, defaulting unknown namespaces to UI-only.
- [ ] 5.3 In `createRpcMessageListener`, resolve the namespace from `message.type` and, for UI-only namespaces, require `sender.id === browser.runtime.id` and a `sender.url` that starts with `browser.runtime.getURL("/")`.
- [ ] 5.4 Reject a failed sender check with `unknown_namespace` before the router is called, so no handler and no service is touched.
- [ ] 5.5 Treat a missing `sender`, a missing `sender.id`, or a missing `sender.url` as untrusted.
- [ ] 5.6 Verify all four extension surfaces still work in a loaded build: popup, sidepanel, options page opened in a tab, and the approval window created by `browser.windows.create`.
- [ ] 5.7 Verify the NIP-07 page path still works end to end from the content script for `nostr.getPublicKey` and `nostr.signEvent`.

## 6. Error Serialization

- [ ] 6.1 Stop passing `error?.message ?? String(error)` as `details` in `RpcRouter.handleRequest` and return an omitted or fixed caller-safe `details` instead.
- [ ] 6.2 Stop passing raw error text as `details` in the `createRpcMessageListener` catch block.
- [ ] 6.3 Keep the internal `console.error` at the catch site subject to the logging policy in group 7, so diagnostics stay available in development without crossing the RPC boundary.
- [ ] 6.4 Confirm the deliberate, safe `details` strings that individual handlers already return are unchanged.

## 7. Logging Policy

- [ ] 7.1 Delete the response-body log at `src/infrastructure/messaging/client.ts:45`.
- [ ] 7.2 Replace the failure log in `client.ts` so it records the method name and the machine error code, not the thrown error object.
- [ ] 7.3 Audit the remaining `console.*` statements in `src/infrastructure/messaging/` and `src/application/services/` for anything that logs a request payload, a response body, a password, or key material, and reduce each to method and status.
- [ ] 7.4 Keep the listener's existing method-plus-status log shape in `rpc-router.ts` as the reference pattern.
- [ ] 7.5 Confirm no log statement anywhere can receive a value returned by `vault.reveal`, `vault.unlock`, or `crypto.parsePrivateKey`.

## 8. Production Console Stripping

- [ ] 8.1 Add `esbuild: { drop: ["console", "debugger"] }` to the object returned by `vite()` in `wxt.config.ts`.
- [ ] 8.2 Coordinate with `harden-manifest-and-build`, which also edits `wxt.config.ts`: land this two-line addition first, or rebase it under the manifest work, rather than having both changes rewrite the file.
- [ ] 8.3 Confirm `pnpm dev` still emits diagnostics so local debugging is unaffected.

## 9. Tests

- [ ] 9.1 Update `tests/unit/infrastructure/rpc-client.test.ts` so its transport assertions use a surviving method instead of `vault.export`.
- [ ] 9.2 Update `tests/unit/infrastructure/rpc-validation.test.ts` so its validation assertions no longer target `vault.sign`.
- [ ] 9.3 Update the `crypto.parsePrivateKey` expectations in `tests/unit/infrastructure/rpc-handlers.test.ts` for the validation-verdict response, and add a case proving `npub` input is rejected.
- [ ] 9.4 Add router tests proving `vault.export` and `vault.sign` return `unknown_method`.
- [ ] 9.5 Add listener tests with a fake `sender` proving an extension-page sender reaches a UI-only namespace and a content-script sender does not.
- [ ] 9.6 Add a listener test proving a page-reachable `nostr` request is accepted from a content-script sender.
- [ ] 9.7 Add router tests proving `__proto__.reveal` and `constructor.reveal` return `unknown_namespace` without invoking anything.
- [ ] 9.8 Add a router test proving an unexpected handler throw does not put the thrown message into `error.data.details`.
- [ ] 9.9 Add a security test asserting no private-key material is reachable through any RPC method without password re-verification.

## 10. PRD And Documentation

- [ ] 10.1 Add a security requirement to `docs/v2-prd.md` covering RPC privilege separation and production log stripping, which no current SEC row states, and record its status.
- [ ] 10.2 Update `docs/rpc-architecture.md` with the page-reachable and UI-only namespace classification and the sender rule.
- [ ] 10.3 Remove `vault.export` and `vault.sign` from any method list in `docs/rpc-architecture.md` or `docs/rpc-error-codes.md` that still advertises them.

## 11. Verification

- [ ] 11.1 Run `openspec validate remove-key-exfiltration-surface --strict`.
- [ ] 11.2 Run `pnpm run compile`.
- [ ] 11.3 Run focused Vitest suites for RPC client, RPC validation, RPC handlers, key vault service, and security.
- [ ] 11.4 Grep `src/` and `tests/` again and confirm zero references remain to `vault.export`, `exportKey`, `vault.sign`, or the `signHash` client wrapper.
- [ ] 11.5 Run `pnpm run build` and confirm `.output/chrome-mv3/` contains no `console.log`, no other `console.*` call site, and no `debugger` statement.
- [ ] 11.6 Run `pnpm run build:firefox` and confirm `.output/firefox-mv2/` contains no `console.*` call site and no `debugger` statement.
- [ ] 11.7 Load the built Chrome extension and confirm popup, sidepanel, options, approval, onboarding import, key reveal, and NIP-07 signing all still work.
- [ ] 11.8 Run relevant Playwright extension tests for onboarding import, key reveal, approval, and NIP-07 signing.
- [ ] 11.9 Defer `npx react-doctor@latest`: it currently fails to install because pnpm blocks it with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. Run it once `restore-security-test-assurance` pins React Doctor locally.

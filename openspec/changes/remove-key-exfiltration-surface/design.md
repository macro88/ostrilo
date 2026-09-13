## Context

The background script registers a single flat `RpcRouter` and one listener:

- `background.ts:282-302` registers ten modules across the `vault`, `policy`, `settings`, `crypto`, `state`, `keys`, `nostr`, `approval`, `activity`, and `profile` namespaces. `VaultRpcHandler` is registered twice, under `vault` and under `keys`.
- `background.ts:310` installs `createRpcMessageListener(router, serviceContext)` on `browser.runtime.onMessage`.
- `rpc-router.ts:101-155` accepts `sender` as its second parameter and never reads it. Every namespace is equally reachable by anything that can send a runtime message.

Two methods on that surface disclose or use secrets with no gate at all:

- `vault.export` (`vault-rpc.ts:248-265`) validates only the optional key-id format, then calls `KeyVaultService.exportKey()` (`key-vault.service.ts:458`), which requires only that the vault is unlocked and returns `{ nsec, hex }`. No password, no consent, no activity-log entry. `revealKey()` sits directly below it at `key-vault.service.ts:473`, documented as "a security-hardened alternative to exportKey that requires password re-entry", and it re-derives the encryption key from the record salt, verifies the password by decrypting, and zeroizes. The UI uses `revealKey`, at `OnboardingCreateKey.tsx:176`. Nothing calls `exportKey`: the only references are the definition, the RPC case, an unused client wrapper at `client.ts:177`, and one test that uses `vault.export` as a convenient arbitrary method name.
- `vault.sign` (`vault-rpc.ts:220-246`) accepts any 64-character hex string plus an optional key id and returns a Schnorr signature over those 32 bytes. No origin, no policy evaluation, no approval prompt, no activity-log entry. It is a blind signing oracle. Its client wrapper `signHash()` at `client.ts:169` has no caller either. Contrast the correct path in `nostr-rpc.ts`, which forces `pubkey` to the selected key (`nostr-rpc.ts:139`), recomputes the event id itself rather than trusting a caller-supplied hash (`nostr-rpc.ts:275`), evaluates policy, routes protected kinds through approval, and writes an activity-log entry on both allow and deny.

Three supporting problems make the surface worse:

- `client.ts:45` is `console.log("[CLIENT] Received response for", method, ":", res)`. It logs the entire response envelope. The onboarding backup step calls `revealKey()`, whose response is `{ ok: true, data: { nsec: "nsec1...", hex: "..." } }`, so revealing a key for backup prints the private key in cleartext to the extension page console. The same is true for `vault.export` and for `crypto.parsePrivateKey`. `client.ts:68` logs the raw thrown error object on every failure.
- `wxt.config.ts` configures no `drop_console`, no terser drop, and no esbuild drop. There are 110 `console.*` statements in `src/`, and the built `.output/chrome-mv3/background.js` contains 34 `console.log` call sites.
- `crypto-rpc.ts:49-66` returns `Array.from(privateKey)`, the raw 32-byte scalar, to whichever extension page called it, where it lands in a JS array that is never zeroized. `KeyInputSchema` (`schemas.ts:72-88`) also accepts `npub1...`, which is meaningless for a private-key parser.

Finally, two low-severity router defects: `handleRequest` indexes a caller-supplied namespace into a plain object literal (`rpc-router.ts:69`), so `__proto__` and `constructor` pass the `if (!module)` existence check and fail later on the method call; and `createRpcErrorResponse` receives `error?.message ?? String(error)` as `details` at `rpc-router.ts:80-83` and `rpc-router.ts:136-143`, so raw internal error text crosses the RPC boundary back toward callers.

### Threat model correction

Nobody should act on the wrong threat model here, so state it plainly: **a co-installed browser extension cannot reach this router.** Cross-extension messages arrive at `chrome.runtime.onMessageExternal`. Ostrilo registers only `browser.runtime.onMessage` and declares no `externally_connectable`; that key is absent from `wxt.config.ts`, from `.output/chrome-mv3/manifest.json`, and from `.output/firefox-mv2/manifest.json`, and `onMessageExternal` appears nowhere in `src/`.

A hostile web page also cannot reach it today. The content script forwards exactly two methods, `getPublicKey` and `signEvent` (`content.ts:66`), and builds its own `RpcRequest` objects rather than passing page data through (`content.ts:74-94`). The page never controls the `type` field.

The real attacker is code executing **inside an Ostrilo extension page**, and the most plausible delivery is a compromised npm dependency: the popup, sidepanel, options, and approval bundles pull in three.js, the Radix set, lucide-react, and qrcode.react. One bad publish anywhere in that tree sends a single `browser.runtime.sendMessage({ type: "vault.export" })` and receives the user's private key. The content-script allowlist is good and it holds, but it is a single layer, it lives in a different file from the thing it protects, and anyone who adds a third forwarded method inherits the entire privileged surface.

## Goals / Non-Goals

**Goals:**

- Delete the passwordless key-disclosure method and the blind signing oracle from the RPC surface entirely.
- Make private-key disclosure available only through a password re-verified path.
- Give the router a privilege boundary: a small page-reachable namespace set, a UI-only set, and enforcement in the listener that already receives `sender`.
- Stop logging RPC envelopes anywhere, and remove all console output from production builds.
- Stop returning raw secret bytes from `crypto.parsePrivateKey`.
- Make namespace dispatch and error serialization boring: no prototype-chain keys, no internal error text.

**Non-Goals:**

- No change to NIP-07 policy evaluation, approval flow, protected-kind handling, or activity-log semantics.
- No new backup, export, or encrypted-archive feature. `secure-key-backup-flow` owns that.
- No manifest permission or CSP changes. `harden-manifest-and-build` owns those.
- No removal of `vault.reveal` and no change to its password verification, which `harden-vault-key-derivation` may revisit.
- No structured logging framework, log levels, or in-extension log viewer. PRD `DEV-003` covers a developer console separately.
- No `externally_connectable` allowlist, because the extension does not accept external messages at all.

## Decisions

### Decision 1: Delete `vault.export` and `KeyVaultService.exportKey()` outright

Remove the `RpcRequest` variant (`rpc.ts:36`), the switch case and `handleExport` (`vault-rpc.ts:40-41`, `vault-rpc.ts:248-265`), the service method (`key-vault.service.ts:458`), and the client wrapper (`client.ts:177-182`). Update the handler doc comment at `vault-rpc.ts:14`.

**Rationale:** This is dead code that is still live on the message bus, and it is pure downside. It has zero callers, so deleting it costs nothing and cannot regress a user flow. It duplicates a capability the product already has in a safer form: `revealKey` requires the password, re-derives from the stored salt, verifies by decrypting, and zeroizes both the derived key and the decrypted key. Leaving `exportKey` in place means the highest-value secret in the product is reachable by a method that no reviewer will ever exercise, so no reviewer will notice when something starts calling it.

**Alternative considered:** Harden `exportKey` to require a password. That would produce two near-identical password-verified disclosure methods, which is a maintenance trap: the next hardening change has to be applied twice, and a future author will pick whichever one they find first.

### Decision 2: Delete `vault.sign` rather than route it through approval

Remove the `RpcRequest` variant (`rpc.ts:40`), the switch case and `handleSign` (`vault-rpc.ts:37-38`, `vault-rpc.ts:220-246`), and the `signHash()` client wrapper (`client.ts:169-175`). Keep `KeyVaultService.sign()` (`key-vault.service.ts:391`) exactly as it is, because `nostr.signEvent` calls it at `nostr-rpc.ts:284` after policy evaluation and approval.

**Rationale:** Removal, not hardening. `vault.sign` has no caller, so there is no consumer to migrate. More importantly, the thing that makes `nostr.signEvent` safe is that it never trusts a caller-supplied digest: it recomputes the event id from the selected key's public key and the event fields, so what the user approved in the prompt is provably what gets signed. A hash-only method cannot offer that. Routing a bare 32-byte digest through the approval UI would show the user an opaque hex string and ask them to consent to it, which is exactly the pattern that makes hardware-wallet blind signing dangerous. Adding an origin parameter would not help either, because the origin would then be supplied by the caller rather than captured by the content script.

**Alternative considered:** Keep `vault.sign` for non-event signing such as NIP-98 HTTP auth or future NIP-46 support, gated by policy and approval. Rejected for now: there is no such consumer in the tree, and when one arrives it should be a method that carries its own semantic payload and recomputes its own digest, the way `nostr.signEvent` does, rather than a generic oracle that already exists.

### Decision 3: Two-tier namespace privilege, enforced in the listener

Classify namespaces in `rpc-router.ts`:

- Page-reachable: `nostr`.
- UI-only: `vault`, `keys`, `policy`, `settings`, `crypto`, `state`, `approval`, `activity`, `profile`.

`createRpcMessageListener` resolves the namespace from `message.type`, and for a UI-only namespace requires a verified extension-page sender before dispatching. Anything else is rejected before the router is called.

**Rationale:** Defense in depth for the highest-value operation in the product, not a fix for a currently-exploitable hole. Today the content-script allowlist is the only thing between a web page and `vault.reveal`, and it protects by omission: it is correct because of what it does not forward. That property is invisible from `rpc-router.ts` and is one PR away from changing. Putting the boundary next to the thing being protected means a future author who forwards a third method gets a rejection from the background instead of silent privilege escalation. The listener already receives `sender`; it just throws it away.

**Alternative considered:** Two routers and two listeners, one per privilege tier. Cleaner in principle, but MV3 gives one `onMessage` channel, so both listeners would still see every message and the second listener would have to return `false` for namespaces it does not own. That is more moving parts for the same guarantee.

### Decision 4: Verify the sender by extension-origin URL, not by absent `sender.tab`

The obvious check, "require `sender.id === browser.runtime.id` and require `sender.tab` to be absent", is wrong for Ostrilo and would break the product. Verified: the options page is declared `options_ui.open_in_tab: true` (`wxt.config.ts:20-23`), and the approval UI is created with `browser.windows.create({ url: browser.runtime.getURL("/approval.html"), type: "popup" })` (`background.ts:167-169`). Both are extension pages hosted in tabs, so both legitimately carry `sender.tab`, and both call UI-only namespaces: `ApprovalPrompt.tsx:3-8` uses `approval.getAll`, `approval.resolve`, `approval.count`, and `keys.list`. Only the popup and the sidepanel would survive an absent-`sender.tab` rule.

`sender.id` alone is also insufficient, because Ostrilo's own content script is our own extension: messages from it carry `sender.id === browser.runtime.id` while running in the page's tab.

The check that actually separates the two is the sender document's URL:

- `sender.id` MUST equal `browser.runtime.id`.
- `sender.url` MUST be present and MUST start with `browser.runtime.getURL("/")`, which is `chrome-extension://<id>/` on Chrome and `moz-extension://<uuid>/` on Firefox. A content script reports the page URL here; an extension page reports its own extension URL.
- A missing or non-extension `sender.url` is untrusted.

`sender.url` is used rather than `sender.origin` because `origin` is not dependably present across Chrome MV3 and Firefox MV2, and Ostrilo ships both.

**Rationale:** This is the property that actually distinguishes "code running in an Ostrilo page" from "code running in a web page", which is the boundary the classification is about. Tab-ness is a hosting detail that Ostrilo's own UI violates in two places.

**Alternative considered:** Give the UI a long-lived `browser.runtime.connect` port with a shared secret and keep `onMessage` for pages only. That is a stronger boundary, but it rewrites every call site in `client.ts` and every UI hook, which is far beyond a surface-removal change.

### Decision 5: Reject privileged requests as `unknown_namespace`

A rejected UI-only request returns `unknown_namespace`, the same response a genuinely unregistered namespace gets, rather than a distinct `denied` or `forbidden` code.

**Rationale:** A page-side caller learns nothing from the response about which namespaces exist or which of its guesses was closer. `denied` in this codebase already means "the user rejected this signing request" (`nostr-rpc.ts`), and reusing it for a transport-privilege failure would corrupt that meaning in the activity log and in NIP-07 error handling.

**Alternative considered:** A dedicated `forbidden` code. Better diagnostics, but it also confirms the surface exists, and it adds a code that only ever appears in a situation that should be impossible in a correct build.

### Decision 6: Null-prototype map for namespace dispatch

Change `RpcRouter.modules` to a `Map<string, RpcModule>`, or to `Object.create(null)`, so `message.type` of `__proto__.reveal` or `constructor.reveal` resolves to nothing and returns `unknown_namespace` at the existence check.

**Rationale:** A `Map` makes the class of bug structurally impossible instead of relying on an input filter, and `Map` is the better fit anyway: the router already has `getRegisteredNamespaces()`, which becomes `[...this.modules.keys()]`. Today the request passes the `if (!module)` check and fails later inside the `try`, which returns `unknown_method` with internal error text attached, so the two low-severity defects compound.

**Alternative considered:** A prototype-key denylist or a `hasOwnProperty` guard. Both work, and both are one refactor away from being dropped by someone who does not know why they are there.

### Decision 7: `crypto.parsePrivateKey` returns a validation verdict

Replace `Array.from(privateKey)` with a validation-only response such as `{ valid: true }`, and stop accepting `npub` for this method by validating against a private-key-only schema instead of the shared `KeyInputSchema`.

**Rationale:** Both callers only need a yes or no. `ImportKeyForm.tsx:52` calls `await parsePrivateKey(keyInput)` and discards the result. `OnboardingImportKey.tsx:108-111` stores the bytes in `parsedKeyRef`, and the only later use is a truthiness gate at `OnboardingImportKey.tsx:164`; the actual import passes the original string to `importKey` at `OnboardingImportKey.tsx:166`. So the raw scalar crosses the message bus, lands in a non-zeroizable JS array in a React ref, and is never read. `parsedKeyRef` becomes a boolean. Accepting `npub` in a private-key parser is a separate small correctness bug: an `npub` is not a private key, and returning "valid" for one invites a caller to treat it as importable.

**Alternative considered:** Keep returning bytes but zeroize the array in the UI. `Array.from` produces a plain array, not a typed array, so there is no zeroize primitive that applies, and the value was never needed in the first place.

### Decision 8: Logging policy for a signer

The rule, stated once so it can be enforced in review: **log the method name and the outcome status, never an RPC envelope, request payload, response body, or thrown error object.**

Concretely:

- Delete `client.ts:45` and replace the failure log at `client.ts:68` with the method name plus the machine error code.
- Keep the shape already used in the listener at `rpc-router.ts:126-134`, which computes `result.ok ? "success" : result.error.data.errorCode` and logs only that. That is the pattern; the client is the outlier.
- Never log a value that came from `vault.reveal`, `crypto.parsePrivateKey`, `vault.unlock`, or any password field.

**Rationale:** In a signer, a response body is a secret until proven otherwise. `[CLIENT] Received response for` was written to debug transport problems, and the method plus status is sufficient for that: knowing that `vault.reveal` returned `success` diagnoses transport, while knowing what it returned diagnoses nothing and prints an `nsec` to a console that any extension-page code can read.

**Alternative considered:** A redacting logger with a per-method allowlist of loggable fields. More capable, but it is a new abstraction that has to be kept correct as methods are added, and the failure mode of forgetting to register a method is that the secret gets logged.

### Decision 9: Strip console from production builds via `esbuild.drop`

Add to the WXT Vite config in `wxt.config.ts`:

```ts
esbuild: { drop: ["console", "debugger"] },
```

This complements Decision 8 rather than replacing it. Decision 8 stops secrets reaching development consoles too, where a screen-share or a support-log paste is a realistic disclosure path.

**Coordination point:** `harden-manifest-and-build` also edits `wxt.config.ts`. That change owns `manifest`, `web_accessible_resources`, and CSP; this change owns the `vite()` return value. If both land in the same window, apply this change first because it is a two-line addition, and rebase the manifest work on top. Do not let the two changes each rewrite the whole config file.

**Rationale:** WXT drives Vite, and esbuild is already in the pipeline for TS transforms, so `drop` needs no new dependency and applies to every entrypoint. WXT sets Vite's mode from the build command, so this drops in production builds while `pnpm dev` keeps its diagnostics.

**Alternative considered:** `terserOptions.compress.drop_console`. That requires switching the minifier to terser, which changes bundle output for every entrypoint and works against the ≤150KB gzipped background-bundle target in `openspec/project.md`.

### Decision 10: Sanitized error details

Stop passing `error?.message ?? String(error)` as `details` (`rpc-router.ts:80-83`, `rpc-router.ts:136-143`). Log the error where it is caught, and return a fixed caller-safe string, or omit `details` entirely.

**Rationale:** Handlers already choose deliberate, safe `details` strings ("Vault is locked. Please unlock first.", "Cannot delete the last remaining key"). The router's catch-all is the only place raw internal text escapes, and it fires exactly on unexpected failures, which is when messages are most likely to contain paths, storage keys, or fragments of the value that caused the throw. The `rpc-validation` requirement is being modified to say this explicitly, so it stays enforced.

**Alternative considered:** Send raw details only in development builds. That is a real technique, but it means the error path behaves differently in the build people test with than in the build users run, and the RPC error contract in `docs/rpc-error-codes.md` should not be build-dependent.

## Risks / Trade-offs

- [Risk] Production loses all console diagnostics, so a user-reported bug cannot be diagnosed from a pasted console log. -> Mitigation: debug in a development build, where logging is intact, by reproducing with `pnpm dev` and loading `.output/chrome-mv3-dev`. The activity log remains the user-facing record of signing decisions, and it is not a console sink. If a persistent production diagnostic is genuinely needed later, PRD `DEV-003` proposes an in-extension developer console, which can log method and status under the Decision 8 rule without a `console` call.
- [Risk] Some consumer depends on `vault.export` or `vault.sign` and the removal breaks it. -> Mitigation: prove the absence in tasks with a repo-wide grep for `vault.export`, `exportKey`, `vault.sign`, and `signHash` across `src/` and `tests/`. The current evidence: `exportKey` appears only as the service definition, the RPC case, the unused client wrapper, and a test that uses the string `vault.export` as an arbitrary method name; `signHash` as a client export has no importer, and the same name in `domain/utils/crypto.ts:303` is an unrelated domain function that stays. `pnpm run compile` catches any missed call site because the `RpcRequest` union is the type source.
- [Risk] The sender check rejects a legitimate Ostrilo surface that was not considered, breaking the popup, sidepanel, options page, or approval window. -> Mitigation: Decision 4 exists precisely because the obvious check breaks two of those four. Verify all four surfaces manually in a loaded build, and cover the accept and reject paths in unit tests against a fake `sender`.
- [Risk] WXT dev mode or a future WXT version changes how extension-page URLs or `sender` fields are reported, and the boundary silently starts rejecting or accepting the wrong callers. -> Mitigation: fail closed, so a broken check makes the UI stop working loudly rather than opening the surface quietly. Assert the classification and the sender rule in unit tests so a WXT upgrade breaks a test rather than a guarantee.
- [Risk] Changing the `crypto.parsePrivateKey` response shape breaks the two import flows. -> Mitigation: both callers use it as a validity check only, and `pnpm run compile` plus the existing `rpc-handlers` test will flag the shape change. `OnboardingImportKey`'s `parsedKeyRef` becomes a boolean flag.
- [Trade-off] `vault.sign` disappears rather than becoming a general-purpose signing primitive, so a future NIP-46 or NIP-98 feature has to add a method with its own payload and digest computation. That is the intended cost: it forces the next author to design what the user is consenting to instead of inheriting a hash-only oracle.
- [Trade-off] Two spec-level namespace lists now exist, the page-reachable set in the router and the forwarded-method allowlist in the content script, and they must stay consistent. Accepted: that is what defense in depth means here, and both are small, enumerated, and covered by tests.

## Migration Plan

1. No data migration. Nothing in `chrome.storage.local` changes, and no key record, policy, setting, or activity entry is touched.
2. No user-visible flow changes. Backup and reveal already go through `vault.reveal`; signing already goes through `nostr.signEvent`.
3. Removing the two `RpcRequest` variants is a compile-time break only inside this repository. `pnpm run compile` enumerates every affected site.
4. Update the two tests that reference the removed methods as arbitrary transport fixtures (`tests/unit/infrastructure/rpc-client.test.ts:63-64`, `tests/unit/infrastructure/rpc-validation.test.ts:135`) to use a surviving method, so the suites keep testing transport and validation rather than the deleted surface.
5. Land before, or rebase under, `harden-manifest-and-build` because both edit `wxt.config.ts`.
6. Rollback is per-decision and independent: the console drop is one config line, the sender check is one guard in the listener, and the deletions are additive to revert. Nothing here is coupled to a stored format, so a revert needs no cleanup.

## Open Questions

- Should `state.getLock` be page-reachable? It is UI-only in this change, and no page path uses it today because the content script infers lock state from the `locked` error code (`content.ts:106`). A future connection-status affordance in the page might want it, and that would be a deliberate widening rather than an oversight.
- Should the `crypto` namespace exist at all? `crypto.evaluatePassword` and `crypto.parsePrivateKey` are pure functions with no vault access, so they could run in the UI bundle and remove a namespace from the surface. `consolidate-crypto-implementations` is the right place to decide that.
- Should a build-time check assert that the emitted bundles contain no `console` call sites, and should it live in this change or in `harden-manifest-and-build` alongside the CSP scan that PRD `SEC-004` describes? This change verifies it by grep in its own verification steps; making it a permanent CI gate is a build-pipeline concern.
- Does the reveal path deserve an activity-log entry? `vault.reveal` is the only remaining way a private key leaves the vault and it currently writes no entry. That is arguably a gap in `secure-key-backup-flow` rather than here, since this change only removes the unlogged alternative.

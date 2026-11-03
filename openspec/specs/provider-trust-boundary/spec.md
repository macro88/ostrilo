# provider-trust-boundary Specification

## Purpose
Defines the trust boundary between an untrusted web page and the extension's injected Nostr provider: where the provider is injected, what the page realm may influence, and how the bridge protects itself from a hostile page.
## Requirements
### Requirement: HTTPS-Only Provider Injection

The extension SHALL inject the NIP-07 content script and `window.nostr` provider only into origins served over HTTPS. Production builds MUST NOT declare plaintext `http://` content script matches.

#### Scenario: Plaintext page receives no provider

- **GIVEN** a production build of the extension is installed
- **WHEN** the user loads a page served over `http://`
- **THEN** the NIP-07 content script SHALL NOT run on that page
- **AND** `window.nostr` SHALL be undefined
- **AND** no signing request SHALL be reachable from that page

#### Scenario: HTTPS page receives the provider

- **GIVEN** a production build of the extension is installed
- **WHEN** the user loads a page served over `https://`
- **THEN** the NIP-07 content script SHALL run
- **AND** `window.nostr` SHALL be defined

#### Scenario: Development builds may allow loopback only

- **GIVEN** a development build produced by `pnpm dev`
- **WHEN** the content script match patterns are generated
- **THEN** any plaintext allowance SHALL be limited to loopback hosts `localhost` and `127.0.0.1`
- **AND** the shipped production manifest SHALL contain no `http://` content script match

---

### Requirement: Page Realm Decides Nothing Security-Critical

The injected provider runs in the page's MAIN world and is therefore page-trusted. The extension SHALL determine the requesting origin, the policy decision, the signing key, the exact bytes to be signed, and the request deadline outside the page realm. The content script SHALL continue to derive the origin from `window.location.origin` and to construct the `RpcRequest` itself rather than forwarding a caller-supplied request type.

#### Scenario: Page-supplied origin is ignored

- **GIVEN** a page script posts a provider request carrying its own `origin` field
- **WHEN** the content script builds the `nostr.signEvent` RPC request
- **THEN** the origin SHALL be taken from `window.location.origin`
- **AND** the page-supplied origin value SHALL be discarded

#### Scenario: Page-supplied RPC type is not forwarded

- **GIVEN** a page script posts a message whose payload names a privileged RPC type such as `vault.export`
- **WHEN** the content script processes the message
- **THEN** the message SHALL be rejected because the method is not in the `getPublicKey` and `signEvent` allowlist
- **AND** no message SHALL be forwarded to the background script

#### Scenario: Page-supplied identifiers and signatures are not trusted

- **GIVEN** a signing request whose event object includes an `id` or `sig` field
- **WHEN** the background script processes the request
- **THEN** it SHALL recompute the event id per NIP-01
- **AND** SHALL ignore any supplied `id` or `sig`

#### Scenario: Provider is not injected into subframes

- **WHEN** the content script match configuration is generated
- **THEN** `all_frames` SHALL remain disabled
- **AND** third-party iframes SHALL NOT receive the provider

---

### Requirement: Tamper-Resistant Provider Property

The extension SHALL define `window.nostr` using a property descriptor that is non-writable and non-configurable, and SHALL freeze the provider object and its method-bearing sub-objects.

#### Scenario: Assignment cannot replace the provider

- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns a different value to `window.nostr`
- **THEN** the assignment SHALL NOT take effect
- **AND** `window.nostr.signEvent` SHALL remain the Ostrilo implementation

#### Scenario: Redefinition and deletion are rejected

- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script calls `Object.defineProperty(window, "nostr", ...)` or `delete window.nostr`
- **THEN** the operation SHALL fail or have no effect
- **AND** the Ostrilo provider SHALL remain reachable

#### Scenario: Provider methods cannot be swapped

- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns a replacement function to `window.nostr.signEvent`
- **THEN** the assignment SHALL NOT take effect

#### Scenario: Existing provider is not overridden

- **GIVEN** another extension already defined `window.nostr`
- **WHEN** the Ostrilo injected script runs
- **THEN** Ostrilo SHALL NOT override the existing object
- **AND** SHALL NOT throw an uncaught error when the existing property is non-configurable

---

### Requirement: Provider Uses Intrinsics Captured At Injection Time

The injected provider SHALL capture the page intrinsics it depends on at injection time, before page scripts execute, and SHALL use those captured references for all subsequent bridge operations.

#### Scenario: Later intrinsic patching does not affect the bridge

- **GIVEN** the provider has been injected at `document_start`
- **WHEN** a page script later replaces `window.postMessage`, `window.addEventListener`, `JSON.stringify`, or `Promise`
- **THEN** the provider SHALL continue to use the references captured at injection time
- **AND** provider requests SHALL still reach the content script

---

### Requirement: No Page-Triggered Extension UI

The extension SHALL NOT open, focus, or otherwise surface the unlock popup in response to a message that originates in a page realm. A locked vault SHALL be reported to the page as an error and signalled to the user through the toolbar action, which only the user can activate.

#### Scenario: Locked vault returns an error without opening a popup

- **GIVEN** the vault is locked
- **WHEN** a page calls `window.nostr.signEvent(event)`
- **THEN** the Promise SHALL reject with the `locked` error code
- **AND** no extension popup or window SHALL be opened

#### Scenario: Locked state is signalled on the toolbar action

- **GIVEN** the vault is locked
- **WHEN** a signing request is rejected because the vault is locked
- **THEN** the toolbar action badge SHALL indicate that a request is waiting for unlock
- **AND** the action title SHALL explain that the vault must be unlocked to sign

#### Scenario: Unlock prompt message is no longer honoured

- **GIVEN** a script sends the runtime message `{ type: "openUnlockPrompt" }`
- **WHEN** the background script receives it
- **THEN** no popup SHALL be opened
- **AND** no window SHALL be created

#### Scenario: Repeated locked requests do not multiply UI

- **GIVEN** the vault is locked
- **WHEN** a page issues many signing requests in rapid succession
- **THEN** every request SHALL receive the `locked` error
- **AND** the only user-visible change SHALL be the toolbar badge state

---

### Requirement: Extension Owns The Request Deadline

The page-side provider deadline and the extension-side approval deadline SHALL derive from one shared constant, and the page-side deadline SHALL never be shorter than the extension-side deadline. The extension-side deadline SHALL be authoritative for whether a signature is produced.

#### Scenario: Approval after the old page-side deadline still resolves

- **GIVEN** the extension-side approval deadline is 60 seconds
- **AND** a signing request is queued for approval
- **WHEN** the user approves the request 45 seconds after it was queued
- **THEN** the page SHALL receive the signed event
- **AND** the signature SHALL NOT be discarded by a page-side timer

#### Scenario: Extension deadline produces the timeout error

- **GIVEN** a signing request is queued for approval
- **WHEN** the extension-side approval deadline elapses without a user decision
- **THEN** the request SHALL be auto-denied by the approval queue
- **AND** the page SHALL receive the `timeout` error code

#### Scenario: Page-side backstop cancels the queued request

- **GIVEN** a signing request is queued for approval
- **WHEN** the page-side backstop deadline fires before any extension-side resolution
- **THEN** the provider SHALL reject the pending Promise with `timeout`
- **AND** the content script SHALL cancel the queued request
- **AND** no signature SHALL be produced for that request afterwards

---

### Requirement: Truthful Capability Advertisement

`window.nostr` SHALL expose only the NIP-07 capabilities the extension actually implements, so that dapp feature detection is accurate.

#### Scenario: Unimplemented encryption capabilities are absent

- **WHEN** a dapp inspects `window.nostr`
- **THEN** `window.nostr.nip04` SHALL be undefined
- **AND** `window.nostr.nip44` SHALL be undefined

#### Scenario: Feature detection selects a working path

- **GIVEN** a dapp that checks for `window.nostr.nip44` before offering encrypted messaging
- **WHEN** the dapp performs the check
- **THEN** the check SHALL be falsy
- **AND** the dapp SHALL be able to fall back without calling a method that always throws

#### Scenario: Implemented capabilities remain advertised

- **WHEN** a dapp inspects `window.nostr`
- **THEN** `getPublicKey` SHALL be a function
- **AND** `signEvent` SHALL be a function

---

### Requirement: Reduced Provider Fingerprint

The extension SHALL avoid leaving stable, page-readable artifacts that identify Ostrilo beyond the `window.nostr` surface a dapp legitimately needs.

#### Scenario: Injected script tag is removed from the DOM

- **GIVEN** the content script has injected the provider script
- **WHEN** the injected script has finished executing
- **THEN** the injecting `script` element SHALL NOT remain in the page DOM
- **AND** the extension id SHALL NOT be discoverable from that element

#### Scenario: No identifying console output in production

- **GIVEN** a production build of the extension
- **WHEN** the provider is injected
- **THEN** the provider SHALL NOT write an identifying banner to the page console

---

### Requirement: Bridge Message Hygiene

Messages exchanged between the injected provider and the content script SHALL use unguessable correlation identifiers, SHALL be posted to the page's own origin rather than to any origin, SHALL be accepted only from the same window and same origin, and SHALL be answered at most once per identifier.

#### Scenario: Correlation ids are unguessable

- **WHEN** the provider creates a request identifier
- **THEN** the identifier SHALL be generated with `crypto.randomUUID()`
- **AND** SHALL NOT be derived from `Date.now()` or `Math.random()`

#### Scenario: Responses are targeted at the page origin

- **WHEN** the content script posts a provider response
- **THEN** the `targetOrigin` argument SHALL be the page's own origin
- **AND** SHALL NOT be `"*"`

#### Scenario: Cross-origin and cross-window messages are rejected

- **WHEN** the content script receives a message whose `source` is not `window`
- **OR** whose `origin` does not equal `window.location.origin`
- **THEN** the message SHALL be ignored
- **AND** no request SHALL be forwarded to the background script

#### Scenario: Each request identifier is answered once

- **GIVEN** a provider request with a given identifier is pending
- **WHEN** more than one response with that identifier is observed
- **THEN** only the first response SHALL settle the pending Promise
- **AND** later responses for that identifier SHALL be ignored

### Requirement: Background Binds The Requesting Origin To The Attested Sender

For every `nostr` namespace request, the background SHALL derive the requesting origin from the browser-attested message sender, SHALL refuse the request with the `invalid_origin` error code when that origin cannot be attested or disagrees with the origin the content script sent, and SHALL pass only the derived origin to request handlers. A sender is attestable only when its extension id is this extension's runtime id, it has a tab, its frame id is `0`, its URL parses with the `https:` scheme, and, where the browser supplies a sender origin, that origin agrees with the URL's origin. A refused request SHALL NOT reach any service, SHALL NOT be charged to any per-origin rate limit, and SHALL NOT create or modify an origin policy or activity entry.

#### Scenario: Matching origins are dispatched with the derived value

- **GIVEN** a `nostr.signEvent` request whose `origin` is `https://a.example`
- **AND** the sender is this extension's content script in the top frame of a tab at `https://a.example/path`
- **WHEN** the background router receives the request
- **THEN** the request is dispatched
- **AND** the handler receives `https://a.example` as the origin

#### Scenario: A claimed origin that disagrees with the sender is refused

- **GIVEN** a `nostr.getPublicKey` request whose `origin` is `https://trusted.example`
- **AND** the sender's URL is `https://attacker.example/`
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code
- **AND** no consent, trust level, or rate-limit state for either origin changes

#### Scenario: A subframe sender is refused

- **GIVEN** a `nostr.signEvent` request from a sender whose frame id is not `0`
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: A sender from another extension is refused

- **GIVEN** a `nostr.signEvent` request whose sender id is not this extension's runtime id
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: A non-HTTPS sender URL is refused

- **GIVEN** a `nostr.getPublicKey` request whose sender URL uses the `http:` scheme
- **WHEN** the background router receives the request
- **THEN** the response carries the `invalid_origin` error code

#### Scenario: Same-document navigation keeps the origin

- **GIVEN** a page at `https://a.example/` that calls `history.pushState` to `/other`
- **WHEN** it then calls `window.nostr.signEvent`
- **THEN** the request is dispatched with origin `https://a.example`

### Requirement: Capabilities Object Is Tamper-Resistant

`window.nostr.capabilities` and its `methods` array SHALL be frozen, so a page script cannot change what the provider advertises to other scripts on the page. Adding the object SHALL NOT weaken any protection of the provider property or its methods.

#### Scenario: Capabilities cannot be replaced
- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns, redefines or deletes `window.nostr.capabilities`
- **THEN** the operation SHALL NOT take effect
- **AND** `window.nostr.capabilities` SHALL still list the implemented methods

#### Scenario: The methods list cannot be altered
- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns to, pushes onto, truncates or redefines `window.nostr.capabilities.methods`
- **THEN** the operation SHALL NOT take effect
- **AND** `window.nostr.capabilities.methods` SHALL be unchanged

#### Scenario: Existing protections still hold
- **GIVEN** `window.nostr` has been defined by Ostrilo with `capabilities`
- **THEN** `window.nostr` SHALL still be non-writable and non-configurable
- **AND** the provider object and its methods SHALL still be frozen


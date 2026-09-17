## Why

The NIP-07 provider is the one surface where untrusted web pages reach Ostrilo's signing key. The bridge itself is built correctly: `handlePageMessage` in `src/extension/content.ts` refuses cross-window messages, allowlists exactly `getPublicKey` and `signEvent`, constructs the `RpcRequest` itself instead of forwarding a caller-supplied type, and takes the origin from `window.location.origin` rather than from the page's payload. That barrier is the only thing standing between a hostile page and the privileged RPC surface, and it must not regress.

Everything around that barrier is weaker than the barrier. The provider is injected into plaintext `http://` pages, so any on-path network attacker can drive `window.nostr`. The approval dialog hides the URL scheme, so a hijacked `http://example.com` renders identically to the real `https://example.com`. Event content and tags have no size bound, are rendered into a clipped panel with no length indicator, and are not neutralized for bidi or zero-width characters, so a hostile event can misrepresent what the user is approving. Any page can force the genuine password popup open on demand, unthrottled. `window.nostr` is a plain writable property. The provider abandons requests at 30 seconds while the approval queue runs for 60, so a user who approves at 45 seconds produces a real signature the page has already discarded. And `nip04`/`nip44` are advertised as capabilities whose every method throws.

## What Changes

- Restrict the NIP-07 content script to `https://*/*` and keep local development working without shipping plaintext HTTP access. **BREAKING** for dapps served over `http://`.
- Show the full requesting origin including scheme in the approval dialog, flag non-HTTPS origins visibly, keep the punycode ASCII hostname form that already resists homoglyph spoofing, and stop CSS-truncating the security-relevant part of the string.
- Bound `content`, `tags`, tag element count, and tag element size in `UnsignedEventSchema`, and bound the total serialized event, so oversized payloads are rejected before they reach `computeEventId` in the service worker.
- Show the true byte length of content and tags in the approval dialog, and render bidi and zero-width control characters as visible escapes so the displayed text cannot misrepresent the signed bytes. The signed bytes are never altered.
- Remove the page-triggered unlock popup. A locked vault returns a clear `locked` error and signals through the toolbar badge, which the page cannot drive. **BREAKING** for the `openUnlockPrompt` runtime message.
- Define `window.nostr` with a non-writable, non-configurable property descriptor and freeze the provider object and its methods.
- Align the page-side provider deadline with the extension-side approval deadline from one shared constant, make the extension-side deadline authoritative, and cancel the queued request if the page-side backstop ever fires so no signature is produced for an abandoned request. **BREAKING** for any dapp depending on the current 30-second rejection.
- Harden bridge hygiene: unguessable request ids from `crypto.randomUUID()`, `postMessage` targeted at the page origin instead of `"*"`, an explicit `event.origin` check, and page intrinsics captured at injection time.
- Rate-limit approval enqueues per origin, cap the queue globally and per origin, remove "Approve all from site" while keeping bulk deny, and stop the detail pane from instantly re-binding the approve action to the next queued request. **BREAKING** for the batch-approve affordance in the current spec.
- Bind the displayed signing key to the pending request instead of to whichever key the approval UI had selected when it loaded.
- Remove `nip04` and `nip44` from the advertised `window.nostr` surface so NIP-07 feature detection is truthful. NIP-44 may be implemented later; NIP-04 will not be added.
- Stop leaving the injected script tag in the page DOM (`keepInDom`), reducing the stable fingerprinting probe for Ostrilo.

Manifest-level hardening of `web_accessible_resources` and `use_dynamic_url` in `wxt.config.ts` is owned by the companion change `harden-manifest-and-build`. This change owns the content script match patterns and the injection mechanics.

## Capabilities

### New Capabilities

- `provider-trust-boundary`: The trust model of the page/extension boundary for NIP-07 — HTTPS-only injection, a tamper-resistant `window.nostr`, no page-drivable extension UI, request lifecycle owned by the extension, truthful capability advertisement, and reduced fingerprinting surface.
- `approval-display-integrity`: The guarantee that what the approval dialog shows is exactly what will be signed — full origin with scheme, non-HTTPS flagging, true payload sizes, neutralized invisible and direction-control characters, and the signing key bound to the request.
- `approval-flood-controls`: Per-origin and global limits on approval enqueues, plus approval-fatigue mitigations in the queue UI.

### Modified Capabilities

- `nip07-provider`: `Window Nostr Object Injection` gains the non-writable descriptor and drops the unconditional assignment; `Get Public Key` and `Sign Event` drop the page-triggered unlock side effect; `Event ID Computation` gains a size precondition; `Message Security` gains origin-targeted responses and unguessable correlation ids; `Error Handling` replaces the stale 10-second timeout with the aligned approval deadline and adds `rate_limited`; `Approval Prompt Display` drops batch approve and shows the bound signing key and full origin; `Pending Request Queue` gains capacity limits.
- `rpc-validation`: `Strict Input Validation` gains concrete size bounds for unsigned event `content` and `tags` so oversized payloads are rejected with `invalid_event` before any hashing work.

## Impact

- Content script: `src/extension/content.ts` match patterns, response targeting, origin check, `injectScript` options, and removal of the `openUnlockPrompt` path.
- Injected provider: `src/extension/injected.ts` property definition, object freezing, request id generation, deadline handling, intrinsic capture, and removal of the `nip04`/`nip44` stubs.
- Background: `src/extension/background.ts` removes the `openUnlockPrompt` listener and gains a locked-pending badge state.
- Validation: `src/infrastructure/validation/schemas.ts` gains bounded `content` and `tags` limits shared with the approval UI.
- Approval queue: `src/application/services/approval-queue.service.ts` gains per-origin rate limiting and capacity caps, and exports the shared timeout constant.
- Approval UI: `EventDetailView.tsx` origin rendering, payload size and control-character display, and bound signing key; `QueueListView.tsx` batch actions and origin rendering; `ApprovalPrompt.tsx` selection re-bind behavior and signing key source.
- Domain types: `PendingRequest` gains the signing key bound at enqueue time.
- Tests: Vitest coverage for schema bounds, control-character escaping, origin formatting, rate limiting, and queue caps; Playwright coverage in `tests/e2e/nip07-provider.spec.ts`, `tests/e2e/approval-flow.spec.ts`, and `tests/e2e/approval-queue-ux.spec.ts`.
- E2E harness: `playwright.config.ts` and `tests/e2e/fixtures/` must serve the provider fixture over HTTPS, because `http://localhost:8765` no longer matches the shipped content script.
- Coordination: `harden-manifest-and-build` owns the matching `web_accessible_resources` narrowing; `restore-security-test-assurance` owns pinning React Doctor locally.

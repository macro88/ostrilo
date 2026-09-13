## 1. Shared Constants And Bounded Validation

- [ ] 1.1 Confirm the current provider path end to end: `injected.ts` request creation, `content.ts` `handlePageMessage`, `NostrRpcHandler.handleSignEvent`, and `ApprovalQueueService.enqueue`.
- [ ] 1.2 Add exported size constants to `src/infrastructure/validation/schemas.ts`: `MAX_EVENT_CONTENT_BYTES` (65,536), `MAX_EVENT_TAGS` (5,000), `MAX_TAG_ELEMENTS` (100), `MAX_TAG_ELEMENT_BYTES` (1,024), `MAX_EVENT_SERIALIZED_BYTES` (1,048,576).
- [ ] 1.3 Bound `UnsignedEventSchema` `content` on UTF-8 byte length rather than string length.
- [ ] 1.4 Bound `UnsignedEventSchema` `tags` on tag count, elements per tag, and UTF-8 byte length per element.
- [ ] 1.5 Add a total serialized-event bound so payloads within every per-field limit still cannot exceed `MAX_EVENT_SERIALIZED_BYTES`.
- [ ] 1.6 Verify `NostrRpcHandler.handleSignEvent` rejects oversized events with `invalid_event` before `computeEventId` runs and before any approval entry is created.
- [ ] 1.7 Export the approval deadline as a shared constant from `src/application/services/approval-queue.service.ts` and add the provider grace constant used by the injected script.

## 2. Content Script Trust Boundary

- [ ] 2.1 Change `matches` in `src/extension/content.ts` to `["https://*/*"]`.
- [ ] 2.2 Set `keepInDom: false` on the `injectScript` call so the injecting script element does not persist in the page DOM.
- [ ] 2.3 Add an `event.origin === window.location.origin` check to `handlePageMessage` alongside the existing `event.source !== window` check.
- [ ] 2.4 Change `sendResponse` to post with `window.location.origin` as `targetOrigin` instead of `"*"`.
- [ ] 2.5 Remove the `openUnlockPrompt` send and return the `locked` error code to the page unchanged.
- [ ] 2.6 Preserve the existing barrier exactly: same-window check, exact message type, string id requirement, two-method allowlist, self-constructed `RpcRequest`, and origin taken from `window.location.origin`.
- [ ] 2.7 Add a narrow cancellation path that resolves a queue entry as denied for a request id the content script itself issued, and that can never resolve one as approved.

## 3. Injected Provider Hardening

- [ ] 3.1 Capture `postMessage`, `addEventListener`, `JSON.stringify`, `Promise`, `crypto.randomUUID`, `setTimeout`, and `clearTimeout` into local bindings at injection time and use those bindings thereafter.
- [ ] 3.2 Replace `generateRequestId` with `crypto.randomUUID()`.
- [ ] 3.3 Derive the page-side deadline from the shared approval constant plus the grace period, and stop hard-coding 30 seconds.
- [ ] 3.4 On page-side timeout, reject with `timeout` and send the cancellation from task 2.7 so no signature is produced for the abandoned request.
- [ ] 3.5 Ignore later responses for a request id that has already settled.
- [ ] 3.6 Remove the `nip04` and `nip44` stub objects from the advertised surface.
- [ ] 3.7 Bail out with a console warning when `window.nostr` already exists, honouring the existing non-override requirement.
- [ ] 3.8 Freeze the provider object and define `window.nostr` with `writable: false` and `configurable: false`, guarding against an uncaught error when the property is already non-configurable.
- [ ] 3.9 Remove the identifying page-console banner from production builds.

## 4. Background Locked-State Signal

- [ ] 4.1 Remove the `openUnlockPrompt` listener and its `browser.action.openPopup()` and `browser.windows.create` fallback from `src/extension/background.ts`.
- [ ] 4.2 Set a distinct amber toolbar badge state and action title when a signing request is refused because the vault is locked.
- [ ] 4.3 Clear the locked-state badge on unlock, and define precedence against the pending-approvals badge count.
- [ ] 4.4 Confirm no remaining code path lets a page-originated message open, focus, or create an extension popup or window.

## 5. Approval Queue Limits

- [ ] 5.1 Add per-origin enqueue rate limiting to `ApprovalQueueService`: 10 new entries per rolling 60-second window.
- [ ] 5.2 Add a per-origin pending cap of 5 and a global pending cap of 20.
- [ ] 5.3 Ensure de-duplicated enqueues reuse the existing entry without consuming rate allowance.
- [ ] 5.4 Release per-origin capacity on both resolution and timeout.
- [ ] 5.5 Surface refusals through `NostrRpcHandler` as `RPC_ERROR_CODES.RATE_LIMITED`.
- [ ] 5.6 Add the bound signing public key to `PendingRequest` in `src/domain/types.ts` and populate it in `NostrRpcHandler.requestApproval` from the pubkey used to compute the event id hash.
- [ ] 5.7 Include the bound signing key in the `approval.getAll` payload.

## 6. Approval Display Integrity

- [ ] 6.1 Replace both copies of `formatDomain` with one shared origin formatter returning scheme, punycode hostname, and non-default port.
- [ ] 6.2 Render the full origin without CSS truncation in `EventDetailView` and `QueueListView`, in mono per `docs/design/DESIGN_RULES.md`.
- [ ] 6.3 Add an amber non-HTTPS warning panel to the approval detail view for origins whose scheme is not `https:`.
- [ ] 6.4 Add a display-only escape transform for bidi controls, zero-width and joiner characters, other Unicode `Cf` characters, and C0/C1 controls other than newline and tab.
- [ ] 6.5 Apply the escape transform to event content, tag values, and the queue-list content preview.
- [ ] 6.6 Show a notice stating that hidden or direction-control characters are present and how many were escaped.
- [ ] 6.7 Label the content panel with the true UTF-8 byte length and the tag panel with tag count and total tag byte length.
- [ ] 6.8 Make the content panel scrollable with an explicit indication that content continues past the visible region.
- [ ] 6.9 Verify the event bytes that get hashed and signed are never altered by the display transform, and that the raw JSON view still shows the exact payload.
- [ ] 6.10 Render "Signing as" from the request's bound signing key and remove the `listKeys()` lookup that guesses it in `ApprovalPrompt`.

## 7. Approval Fatigue Mitigations

- [ ] 7.1 Remove "Approve all from site" from `QueueListView` and keep "Deny all from site" and the global "Deny all".
- [ ] 7.2 Stop `approvalPromptReducer` from auto-selecting `requests[0]` after a resolution, and return the user to the queue list.
- [ ] 7.3 Disable the approve action for a 500 ms cooldown whenever the detail view binds to a request id it was not previously showing.
- [ ] 7.4 Keep the deny action enabled throughout the cooldown.
- [ ] 7.5 Re-check the approval surfaces against `docs/design/DESIGN_RULES.md`: one notched primary CTA, amber warning panels, mono for cryptographic data, no emoji in chrome, light and dark.

## 8. E2E Harness Over HTTPS

- [ ] 8.1 Serve `tests/e2e/fixtures` over TLS in `playwright.config.ts` with a development-only certificate for `localhost`.
- [ ] 8.2 Launch Chromium with `--ignore-certificate-errors` and `ignoreHTTPSErrors: true` in `tests/e2e/fixtures/extension.ts`.
- [ ] 8.3 Update every fixture navigation from `http://localhost:8765` to `https://localhost:8765`.
- [ ] 8.4 Assert `window.nostr` is defined before each provider test proceeds, so a broken fixture fails loudly instead of silently passing.

## 9. Tests

- [ ] 9.1 Add schema tests for content, tag count, tag element count, tag element size, and serialized-event bounds, including a multi-byte case proving UTF-8 byte measurement.
- [ ] 9.2 Add schema tests proving typical note, reaction, profile, relay list, and contact list events still validate.
- [ ] 9.3 Add unit tests for the origin formatter: HTTPS, plaintext, non-default port, punycode hostname, and malformed input.
- [ ] 9.4 Add unit tests for the control-character escape transform, including `U+202E`, `U+200B`, `U+FEFF`, preserved newline and tab, and unchanged ordinary right-to-left text.
- [ ] 9.5 Add unit tests proving the escape transform does not alter the signed payload or the computed event id.
- [ ] 9.6 Add `ApprovalQueueService` tests for the per-origin rate limit, per-origin cap, global cap, capacity release on resolve and on timeout, and de-duplication not consuming allowance.
- [ ] 9.7 Add `NostrRpcHandler` tests proving oversized events return `invalid_event` without hashing or enqueueing, and that flooded origins return `rate_limited`.
- [ ] 9.8 Add tests proving the bound signing key travels on `PendingRequest` and that changing the active key mid-approval changes neither the displayed key nor the signed key.
- [ ] 9.9 Add UI tests for full-origin display, the non-HTTPS warning, size labels, the hidden-character notice, absence of bulk approve, and the approve-action cooldown.
- [ ] 9.10 Add tests proving a locked signing request returns `locked` without opening any extension popup or window.
- [ ] 9.11 Add Playwright coverage in `tests/e2e/nip07-provider.spec.ts`: provider present on HTTPS, absent on plaintext, non-writable and non-configurable `window.nostr`, `nip04` and `nip44` undefined, and no injected script element left in the DOM.
- [ ] 9.12 Add Playwright coverage in `tests/e2e/approval-flow.spec.ts`: approving at 45 seconds still delivers the signature to the page, and the extension-side deadline produces `timeout`.
- [ ] 9.13 Add Playwright coverage in `tests/e2e/approval-queue-ux.spec.ts`: flooding an origin yields `rate_limited`, bulk approve is absent while bulk deny works, and the detail pane does not re-bind after a resolution.

## 10. Spec And Documentation Reconciliation

- [ ] 10.1 Confirm the corrected `nip07-provider` claims match the code: the `OSTRILO_NOSTR_` message prefix and the approval-aligned timeout replacing the stale 10-second value.
- [ ] 10.2 Note the coordination boundary with `harden-manifest-and-build` for `web_accessible_resources` narrowing and `use_dynamic_url`, and verify `injectScript` still resolves the resource once that change lands.
- [ ] 10.3 Update `docs/v2-prd.md` status notes to reflect the shipped provider trust boundary, approval display integrity, and flood controls.
- [ ] 10.4 Document the HTTPS local development requirement for anyone testing against a local dapp.

## 11. Verification

- [ ] 11.1 Run `openspec validate harden-provider-trust-boundary --strict`.
- [ ] 11.2 Run `pnpm run compile`.
- [ ] 11.3 Run focused Vitest suites for validation schemas, approval queue, NIP-07 RPC handling, origin formatting, and the approval UI.
- [ ] 11.4 Run `pnpm run test:security` to confirm no regression in the existing security suite.
- [ ] 11.5 Run Playwright coverage for `tests/e2e/nip07-provider.spec.ts`, `tests/e2e/approval-flow.spec.ts`, and `tests/e2e/approval-queue-ux.spec.ts`.
- [ ] 11.6 Run `pnpm run build` and `pnpm run build:firefox`, and confirm the generated Chrome and Firefox manifests contain no `http://` content script match.
- [ ] 11.7 Defer `npx react-doctor@latest`. It currently fails to install because pnpm rejects it with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. Run it once `restore-security-test-assurance` pins React Doctor locally.

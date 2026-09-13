## Context

The NIP-07 provider is Ostrilo's only inbound path from arbitrary web content to the signing key. It has three tiers:

- `src/extension/injected.ts` runs in the page's MAIN world. Anything it does is page-trusted by construction.
- `src/extension/content.ts` runs in the isolated content-script world. It is the trust boundary.
- `src/extension/background.ts` and `NostrRpcHandler` run privileged, validate with Zod, evaluate policy, and hold keys.

The boundary itself is built correctly and must not regress. `handlePageMessage` (content.ts:57-133) rejects messages whose `source` is not `window`, requires the exact `OSTRILO_NOSTR_REQUEST` type and a string `id`, allowlists exactly `getPublicKey` and `signEvent` (line 66), builds the `RpcRequest` object itself (lines 74-94) instead of forwarding a caller-supplied `type`, and reads the origin from `window.location.origin` (line 69), which the page cannot forge. `NostrRpcHandler` then re-validates the event and origin and recomputes the event id, never trusting a supplied `id` or `sig`. The content script is also top-frame only, because `defineContentScript` leaves `all_frames` unset.

What is weak is everything arranged around that boundary:

- The content script matches `["http://*/*", "https://*/*"]` (content.ts:35), which the generated `.output/chrome-mv3/manifest.json` confirms. On a plaintext page, an on-path attacker injects script and drives `window.nostr`.
- `formatDomain` (EventDetailView.tsx:387-393, duplicated in QueueListView.tsx:312-319) returns `url.hostname`, dropping scheme and port, and the result is rendered inside a CSS-truncating `h2` (line 122). `http://example.com` and `https://example.com` display identically. Policy keys use the full origin, so a remembered grant is not silently inherited across schemes, but the prompt cannot tell the user which origin it is talking about.
- `UnsignedEventSchema` (schemas.ts:140-146) declares `content: z.string()` and `tags: z.array(z.array(z.string()))` with no bounds at any level. The content panel (EventDetailView.tsx:183-191) is a `pre` with `whitespace-pre-wrap break-all` in a height-limited container, with no size indicator and no neutralization of bidi or zero-width characters. Multi-megabyte content also reaches `computeEventId` in the service worker.
- When signing fails on a locked vault, content.ts:112 sends `{ type: "openUnlockPrompt" }`, and background.ts:315-335 calls `browser.action.openPopup()` with a `browser.windows.create` fallback. `default_popup` is declared in the manifest (`"action":{"default_title":"Ostrilo","default_popup":"popup.html"}`), so `openPopup` is viable. There is no user-gesture requirement and no rate limit, so any page can pop the genuine password prompt on demand.
- `window.nostr` is assigned with a plain `(window as any).nostr = nostr` (injected.ts:184), so it is writable and configurable.
- Request ids come from `Date.now()` and `Math.random()` (injected.ts:38-40), the provider's response listener accepts any same-window message of the right type (injected.ts:84-116), and the content script replies with `window.postMessage(response, "*")` (content.ts:145).
- The provider abandons requests at 30 seconds (injected.ts:51-54) while `ApprovalQueueService` uses `DEFAULT_TIMEOUT_MS = 60_000` (approval-queue.service.ts:9).
- Nothing rate-limits enqueues per origin, `QueueListView` offers "Approve all from site" (line 199-205), `ApprovalPrompt`'s `loadSuccess` reducer re-selects `requests[0]` (line 56-72) so the desktop detail pane instantly re-binds the approve button, and "Signing as" (EventDetailView.tsx:136-146) renders `state.selectedKey`, resolved from `listKeys()` when the approval UI loaded (ApprovalPrompt.tsx:107-118), not the key bound to the request.
- `injected.js` is web-accessible to every http and https origin with no `use_dynamic_url` (wxt.config.ts:12-19), `injectScript` is called with `keepInDom: true` (content.ts:43-45), and the provider logs an identifying banner into the page console (injected.ts:186).
- `nip04` and `nip44` are advertised (injected.ts:163-181) as objects whose every method throws.

Two existing spec claims are also stale against the code and are corrected here: `nip07-provider` "Message Security" specifies an `OSTRILO_NIP07_` message prefix while the code uses `OSTRILO_NOSTR_`, and "Error Handling" specifies a 10-second timeout while the code uses 30 seconds.

Two companion changes constrain scope. `harden-manifest-and-build` owns `wxt.config.ts` manifest edits, including narrowing `web_accessible_resources` and adding `use_dynamic_url`. `restore-security-test-assurance` owns pinning React Doctor locally, which currently cannot be installed because pnpm rejects `npx react-doctor@latest` with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`.

## Goals / Non-Goals

**Goals:**

- Remove plaintext HTTP from the provider's attack surface.
- Make the approval dialog incapable of misrepresenting the origin or the payload it is asking the user to authorize.
- Bound the payload a page can push into the service worker and into the approval UI.
- Take the extension's own UI out of page control.
- Make `window.nostr` hard to overwrite, and be honest about what that does and does not buy.
- Make the extension the single authority on how long a signing request lives.
- Make approval fatigue harder to induce and harder to exploit.
- Make NIP-07 feature detection truthful.

**Non-Goals:**

- No attempt to defend a page from itself. Nothing in the MAIN world can be made trustworthy against the realm that hosts it.
- No NIP-04 or NIP-44 implementation in this change.
- No changes to policy evaluation, trust levels, protected kinds, or remembered site policies.
- No `wxt.config.ts` manifest edits; those belong to `harden-manifest-and-build`.
- No new permissions, no relay traffic, no telemetry.
- No cryptographic changes to event id computation or signing.

## Decisions

### Decision 1: HTTPS-only content script matches, and an HTTPS local development loop

Change `matches` in `src/extension/content.ts` to `["https://*/*"]`. Ship that in every build, including development.

What breaks: local development and the Playwright harness. `playwright.config.ts` serves `tests/e2e/fixtures` with `http-server -a 127.0.0.1 -p 8765`, and `tests/e2e/nip07-provider.spec.ts` navigates to `http://localhost:8765/test-page.html`. A match pattern is literal URL matching; it does not care that Chromium treats `http://localhost` as a potentially-trustworthy origin. So every provider E2E test stops seeing `window.nostr`.

The fix is to move the local loop to HTTPS rather than to keep a plaintext allowance:

- Serve the fixture over TLS (`http-server -S` with a development-only self-signed certificate for `localhost` kept under `tests/e2e/fixtures/`, or an equivalent tiny Node HTTPS server).
- Launch Chromium with `--ignore-certificate-errors` in `tests/e2e/fixtures/extension.ts` and set `ignoreHTTPSErrors: true`.
- Update the provider, approval, and queue specs to navigate to `https://localhost:8765/...`.
- Document the same approach (a locally trusted certificate) for manual development against a local dapp.

**Rationale:** The configuration that ships is then the configuration that is developed and tested against. A plaintext allowance that exists only in dev builds means the shipped match list is never exercised locally, and it leaves a code path whose only protection is a build flag.

**Alternative considered:** gate a loopback allowance on `import.meta.env.DEV`, producing `["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]` in dev and `["https://*/*"]` in production. WXT evaluates entrypoint options at build time, so this works, and it keeps the current dev ergonomics. It is rejected as the primary approach for the reason above, but it is a reasonable escape hatch if the HTTPS dev loop proves too costly in practice. If it is adopted, the allowance must be loopback hosts only, never `http://*/*`, and a build check should assert the production manifest contains no `http://` content script match.

### Decision 2: Show the full origin, flag non-HTTPS, keep punycode, stop truncating

Replace both copies of `formatDomain` with one shared origin formatter that returns the full origin string: scheme, `URL.hostname`, and the port when it is not the scheme default. Render it without `truncate`; let it wrap. Keep `URL.hostname` rather than `URL.host` decomposition through any Unicode-normalizing path, because `hostname` returns the punycode ASCII form (`xn--...`) for internationalized domains, which is what resists homoglyph spoofing. That property is already correct and must be preserved.

When the scheme is not `https:`, render an amber warning panel per `DESIGN_RULES.md` §7 stating that the connection is not encrypted and that the request may not come from the site the user expects. This matters even after Decision 1, because the approval UI also renders origins from remembered policies and from activity history, and because a future dev build could reintroduce a plaintext path.

The origin is security-relevant cryptographic-adjacent data, so it is rendered in mono per `DESIGN_RULES.md` §4, with the seal-mark identity block unchanged.

**Rationale:** The user's only defence against a hijacked plaintext origin is being able to see that it is plaintext. Hiding the scheme makes `http://example.com` and `https://example.com` the same prompt.

**Alternative considered:** keep the bare hostname as the headline and add a small scheme chip beside it. Rejected: two elements can be visually separated by truncation, wrapping, or a narrow viewport, and the headline is what users read. One unambiguous string is harder to misread.

### Decision 3: Bound the event in the schema, with concrete limits

Add bounds to `UnsignedEventSchema` in `src/infrastructure/validation/schemas.ts`, exported as named constants so the approval UI can reuse them:

| Limit | Value |
|---|---|
| `MAX_EVENT_CONTENT_BYTES` | 65,536 (64 KiB) |
| `MAX_EVENT_TAGS` | 5,000 |
| `MAX_TAG_ELEMENTS` | 100 |
| `MAX_TAG_ELEMENT_BYTES` | 1,024 |
| `MAX_EVENT_SERIALIZED_BYTES` | 1,048,576 (1 MiB) |

All byte limits are measured on UTF-8 encoded length, not `String.length`, so multi-byte content cannot slip past a character count. The serialized-event bound is the real backstop: 5,000 `p` tags at roughly 110 serialized bytes each already approaches 1 MiB, so the two limits interlock.

`NostrRpcHandler.handleSignEvent` already validates before anything else (nostr-rpc.ts:95-101), so bounded validation automatically precedes `computeEventId` and the approval enqueue. Rejection uses the existing `invalid_event` code.

**Rationale:** 64 KiB of content is roughly a 10,000-word long-form article, far past any real note; 5,000 tags covers a heavy contact list; 1 MiB is trivial for the service worker to hash and store while eliminating multi-megabyte memory pressure. The limits are generous enough that no honest client should notice and tight enough that the abuse case disappears.

**Alternative considered:** enforce only a single total-size limit. Rejected: a single 1 MiB limit still allows a 900 KiB content blob that no approval dialog can meaningfully display, and per-field limits give precise, actionable error details.

**Alternative considered:** enforce limits in the content script instead. Rejected: the content script would have to parse and measure untrusted data before the privileged validator does, duplicating the schema and creating a second place to get it wrong. The background stays the single validation authority.

### Decision 4: Disclose true sizes, and neutralize invisible characters in display only

Two additions to the approval detail view, plus the queue preview:

1. Label the content and tag panels with true sizes, per `DESIGN_RULES.md` §7 ("label the panel (EVENT · size)"): content UTF-8 byte length, tag count, and total tag byte length. Make the content panel scrollable with an explicit indication that content continues past the visible region, so a payload cannot be buried below the fold.
2. Render a *display* transform that replaces bidi controls (`U+202A`-`U+202E`, `U+2066`-`U+2069`, `U+200E`, `U+200F`, `U+061C`), zero-width and joiner characters (`U+200B`-`U+200D`, `U+2060`, `U+FEFF`), other Unicode `Cf` format characters, and C0/C1 controls other than `\n` and `\t`, with a visible escape such as `<U+202E>`. Apply it to content, tag values, and the queue-list content preview. When at least one character is escaped, show an amber panel stating that the payload contains hidden or direction-control characters and how many.

The transform is applied to the rendered string only. The event object that is hashed and signed is never touched.

The governing principle: **what the user approves must be exactly what gets signed, and the display must not be able to lie about it.** A display that silently rewrites the payload breaks that principle just as badly as a display that hides part of it, because the user would then approve something other than what is signed.

**Rationale:** A right-to-left override lets an attacker present text whose visual order is not its logical order. Zero-width characters let an attacker hide content between visible characters. Escaping makes both visible without changing the bytes.

**Alternative considered:** reject events containing bidi or zero-width characters outright. Rejected: legitimate Arabic and Hebrew content uses `U+200F` and friends, and NIP-01 places no such restriction. Rejecting would break real users to defend against a display problem.

**Alternative considered:** strip the characters before signing so the display and the payload agree. Rejected outright: it changes the user's message without telling them, and it means the extension signs something the dapp did not ask for.

### Decision 5: Delete the page-triggered unlock popup

Remove the `openUnlockPrompt` send from `content.ts` and the corresponding listener from `background.ts`. On a `locked` result, the content script simply returns the `locked` error code to the page.

Replace the popup with a signal the page cannot drive: when a signing request is refused because the vault is locked, the background sets a distinct toolbar action badge state (amber warning per `DESIGN_RULES.md` §3, with a `setTitle` explaining that the vault must be unlocked to sign) and clears it on unlock. The badge is idempotent state, so a page issuing a thousand locked requests changes nothing beyond the first.

The popup then opens only when the user clicks the toolbar action, which is the one channel a page cannot reach.

**Rationale:** A password prompt that any site can summon is a phishing primitive: the page renders a convincing imitation next to the real one, or simply trains the user to type their password whenever a prompt appears after a page interaction. There is no rate limit that makes a page-summonable password prompt safe.

**Alternative considered:** keep the popup but require a user gesture and rate-limit it. Rejected: a gesture is trivially obtained from a page (any click on the page satisfies it), and the resulting prompt is still page-timed, which is the property that makes it useful for phishing.

**Alternative considered:** notify through `chrome.notifications`. Rejected: it needs a new permission, contradicts the project's minimal-permission constraint, and is still page-timed.

### Decision 6: Define `window.nostr` non-writable and non-configurable, and be honest about the limits

Replace the assignment at injected.ts:184 with:

- bail out with a console warning if `window.nostr` already exists, which the `nip07-provider` spec has always required and the code has never done;
- `Object.freeze` the provider object;
- `Object.defineProperty(window, "nostr", { value: provider, writable: false, configurable: false, enumerable: true })`, wrapped so that a pre-existing non-configurable property produces a warning rather than an uncaught `TypeError`.

Also capture the intrinsics the bridge needs (`window.postMessage`, `window.addEventListener`, `JSON.stringify`, `Promise`, `crypto.randomUUID`, `setTimeout`, `clearTimeout`) into local bindings at injection time, before page scripts run, and use those bindings thereafter.

The honest note: the injected script runs in the page's MAIN world, so a page that wants to subvert it can. It can replace intrinsics before our script runs if it is an extension content script that runs earlier, wrap the very functions our captured references point at, patch `console`, or simply not call `window.nostr` and phish the user directly. Freezing defeats casual overwriting, drive-by suppression, and the trivial `window.nostr = fake` phishing pattern; it does not create a trust boundary. The boundary is the content script.

Which decisions currently live in the page realm, and what happens to them:

- **Origin** — not decided in the page realm. Derived in the content script. No change.
- **Policy, key selection, event bytes as signed, event id** — not decided in the page realm. No change.
- **Request correlation id** (injected.ts:38-40) — page realm, and it stays there, because it only correlates a page-realm promise with a page-realm response. Moving to `crypto.randomUUID()` is hygiene: an unguessable id means forging a response requires observing the request rather than guessing a timestamp. It is not a boundary, because a script in the same realm can observe anything.
- **Request deadline** (injected.ts:51-54) — page realm today, and this is the one page-realm decision with a real security consequence: it silently discards a signature the user genuinely authorized. Decision 7 moves the authority to the extension.
- **Error message mapping** (injected.ts:96-112) — page realm, cosmetic, stays.

**Rationale:** Cheap, standards-based, removes the easiest provider-hijack primitive, and costs nothing at runtime.

**Alternative considered:** define an accessor whose getter returns the provider, allowing detection of override attempts. Rejected: a getter that cannot be replaced is functionally identical to a non-writable value for the page, adds a call on every access, and gives the extension no trustworthy place to report a tamper attempt from.

### Decision 7: One deadline, owned by the extension

Export the approval deadline as a single shared constant (`APPROVAL_TIMEOUT_MS = 60_000`, already the value in `approval-queue.service.ts:9`) and derive the provider's page-side timer from it as `APPROVAL_TIMEOUT_MS + PROVIDER_GRACE_MS`, with a small grace (5 seconds) to cover message latency. The extension-side deadline is authoritative: when it elapses, the queue auto-denies and the page receives `timeout`.

If the page-side backstop does fire first — which now means the extension failed to answer at all — the provider rejects with `timeout` and the content script sends a cancellation for that request id so the queue entry is resolved as denied. No signature is produced for a request the page has abandoned.

Cancellation is page-reachable by construction, and that is acceptable: a page can already deny its own request by not calling `signEvent`, and request ids only address requests made from that same page realm. The cancellation path must therefore be a narrow, allowlisted method that can only resolve a queue entry as *denied*, never as approved, and only for a request id the content script itself issued.

**Rationale:** The current 30-second page timer against a 60-second queue means the window between 30 and 60 seconds produces a real signature that the page throws away, while the user believes their approval was used. That is the worst possible failure mode for a signer: a silent, user-invisible divergence between what was authorized and what was delivered.

**Alternative considered:** raise the provider timer to exactly 60 seconds. Rejected: equal deadlines race, and the loser is decided by message latency.

**Alternative considered:** drop the page-side timer entirely and rely on the extension. Rejected: if the service worker is evicted mid-request the page would hang forever with no way to recover. The backstop must exist; it just must not be the authority.

### Decision 8: Rate-limit enqueues, cap the queue, and remove the fatigue affordances

In `ApprovalQueueService`:

- Per-origin enqueue rate limit: at most 10 new approval entries per rolling 60-second window per origin.
- Per-origin pending cap: 5.
- Global pending cap: 20.
- Exceeding any limit refuses the enqueue, and `NostrRpcHandler` returns the existing `RPC_ERROR_CODES.RATE_LIMITED` (`"rate_limited"`).
- De-duplicated enqueues do not consume allowance, because they reuse an existing entry and add no user-visible prompt.
- Auto-signed requests never touch the queue, so a trusted origin's throughput is unaffected.

In the approval UI:

- Remove "Approve all from site" from `QueueListView`. Keep "Deny all from site" and the global "Deny all". Bulk denial is safe because denial needs no payload review; bulk approval signs payloads the user never opened, which is exactly the primitive approval fatigue exploits.
- Stop auto-selecting a request after resolution. `approvalPromptReducer`'s `loadSuccess` currently falls back to `requests[0]?.id`, which re-binds the desktop detail pane and puts a live approve button under the cursor. After a resolve, clear the selection and return to the list.
- When the detail view binds to a request id it was not previously showing, disable the approve action for a 500 ms cooldown. Deny stays enabled throughout, because the safe action should never be delayed.

**Rationale:** Unbounded enqueues plus a one-click bulk approve plus an instantly re-bound approve button compose into a practical attack: flood the queue, wait for the user to start clearing it, and collect signatures on payloads they never read. Removing any one of the three helps; removing all three closes the pattern.

**Alternative considered:** keep bulk approve but require a confirmation dialog. Rejected: a confirmation that summarizes N payloads is either a wall of text nobody reads or a summary that hides the payloads, which reintroduces the display-integrity problem from Decision 4.

**Alternative considered:** rate-limit in the content script. Rejected: the limit must be per origin across all tabs and frames, and only the background sees that.

### Decision 9: Bind the signing key to the pending request

Add the signing public key to `PendingRequest` in `src/domain/types.ts`, populated by `NostrRpcHandler.requestApproval` from the `pubkey` it already computed the event id hash with (nostr-rpc.ts:207-213). Render that value in the "Signing as" row instead of `state.selectedKey`, and drop the `listKeys()` lookup that `ApprovalPrompt` uses to guess it (ApprovalPrompt.tsx:107-118).

The background is already correct here: `handleSignEvent` captures `selectedKey` at nostr-rpc.ts:129-130 and uses that same binding at line 284 after the approval await, so switching the active key mid-approval does not change what gets signed. Only the UI is wrong, and the mismatch is exactly the kind of lie Decision 4 forbids: the dialog would name key B while the extension signs with key A, and the displayed event id hash would not match the signed event.

**Rationale:** The signing identity is part of what the user is authorizing. Deriving it from ambient UI state rather than from the request makes the prompt wrong whenever the two diverge.

**Alternative considered:** re-resolve the selected key when the detail view renders. Rejected: it is the same bug with fresher data. The request, not the UI, knows which key it is bound to.

### Decision 10: Remove `nip04` and `nip44` from the advertised surface

Delete both stub objects from `injected.ts`. Do not replace them.

NIP-44 is the right thing to implement later: versioned, ChaCha20 with HMAC-SHA256 authentication, and padded plaintext so ciphertext length does not leak message length. It needs its own change with its own test vectors, key-derivation review, and approval UX for decryption requests, none of which belong here.

NIP-04 should not be added at all. It is unauthenticated AES-256-CBC, so ciphertexts are malleable and carry no integrity guarantee; it leaks plaintext length directly; and it is deprecated in the NIP repository in favour of NIP-44. Shipping it would mean shipping a known-broken construction to serve dapps that have a better option available.

**Rationale:** NIP-07 feature detection is a truthfulness contract. A dapp that sees `window.nostr.nip44` reasonably concludes encrypted messaging works, takes that path, and fails at the point of use — worse for the user than never offering it, because the failure happens after they composed a message.

**Alternative considered:** keep the objects but have the methods reject with a clear "not implemented" error. Rejected: that is the current behaviour, and it is the source of the problem. Absence is the only signal feature detection understands.

### Decision 11: Reduce the fingerprinting surface within this change's scope

Set `keepInDom: false` on the `injectScript` call so the injecting `script` element does not persist in the page DOM with the extension id in its `src`. Remove the identifying console banner at injected.ts:186 from production builds; a page can patch `console.log` and read its arguments.

This does not make Ostrilo undetectable — `window.nostr` existing at all is a signal, and that is unavoidable for a NIP-07 signer. It removes the stable, cheap probes that identify Ostrilo specifically rather than "some NIP-07 signer".

Narrowing `web_accessible_resources` to `https://*/*` and adding `use_dynamic_url: true` belongs to `harden-manifest-and-build`. Note the ordering dependency: with `use_dynamic_url` enabled, WXT's `injectScript` continues to work because it resolves the resource through `browser.runtime.getURL`, which returns the rotating URL. That should be verified when the companion change lands.

**Rationale:** Fingerprinting is a low-severity issue, but the mitigations here are one-line changes with no functional cost.

**Alternative considered:** inject the provider only after a page calls a handshake method. Rejected: it breaks the `nip07-provider` requirement that `window.nostr` is available before `DOMContentLoaded`, which real dapps rely on.

## Risks / Trade-offs

- [Risk] HTTPS-only matches break every dapp served over plaintext HTTP, including local development servers and any intranet dapp on `http://`. -> Mitigation: this is the intended breaking change and is called out as **BREAKING** in the proposal. Provide the HTTPS local fixture path from Decision 1, document the locally trusted certificate workflow, and keep the `import.meta.env.DEV` loopback allowance documented as an escape hatch if the HTTPS dev loop proves unworkable.
- [Risk] The Playwright suite is currently the only automated proof that the provider works end to end, and all of it navigates to `http://localhost:8765`. Getting the TLS fixture wrong silently turns those tests into no-ops rather than failures. -> Mitigation: add an explicit assertion that `window.nostr` is defined on the fixture page before each provider test proceeds, so a broken fixture fails loudly instead of skipping.
- [Risk] Dapps that rely on the current 30-second rejection will now wait up to 65 seconds. A dapp with its own shorter timer will see behaviour it has never seen: a signature arriving after it gave up. -> Mitigation: the change is called out as **BREAKING**; the page-side cancellation in Decision 7 guarantees that a request the page abandoned cannot later produce a signature.
- [Risk] A frozen, non-configurable `window.nostr` cannot be replaced by another signer extension that loads later, and cannot be shimmed by dapps or test harnesses that currently stub `window.nostr`. -> Mitigation: honour the existing "do not override an existing provider" requirement so the first signer to load wins rather than the last, keep the console warning so the conflict is diagnosable, and use the extension's own RPC surface rather than a `window.nostr` stub in tests.
- [Risk] Freezing invites a false sense of security. -> Mitigation: Decision 6 states the limits explicitly, and the `provider-trust-boundary` spec requires that no security-critical decision be taken in the page realm, which is the property that actually holds.
- [Risk] The size limits could reject a legitimate large payload, most plausibly a NIP-78 application-data event (kind `30078`) storing a big client blob. -> Mitigation: limits are named exported constants with generous headroom, the rejection is a clear `invalid_event` with per-field detail, and raising a specific limit is a one-line change if a real client is found to exceed it.
- [Risk] Escaping invisible characters makes some legitimate text uglier, particularly mixed-direction content where an author used explicit marks. -> Mitigation: escapes are display-only and the raw JSON view still shows the exact payload; the amber notice explains why the escapes are there.
- [Risk] Per-origin rate limits could break a legitimately bursty client that needs many distinct approvals at once, for example a first-run client publishing profile, relay list, and contacts together. -> Mitigation: 10 enqueues per 60 seconds against a 5-deep pending cap is far above that pattern, auto-signed kinds never enqueue, and de-duplicated retries do not consume allowance.
- [Risk] Removing bulk approve slows down users who genuinely want to clear several requests from a site they trust. -> Mitigation: the durable per-site kind policies from `fix-remembered-site-signing-policies` are the supported way to stop being asked repeatedly, which is a better answer than approving unread payloads.
- [Risk] Removing `nip04`/`nip44` changes the code path a dapp takes today, from "call and fail" to "capability absent". A dapp with a poor fallback might degrade differently than before. -> Mitigation: absence is the NIP-07-defined signal, and the current behaviour already fails; failing earlier and more predictably is strictly better.
- [Risk] Removing the page-triggered unlock popup makes the locked case quieter, and a user may not notice the badge. -> Mitigation: the badge plus action title is the same channel already used for pending approvals, and the page receives an explicit `locked` error it can surface in its own UI.
- [Risk] Several changes touch `ApprovalQueueService` and `PendingRequest`, which `add-trust-level-policy-system` and `fix-remembered-site-signing-policies` also depend on. -> Mitigation: `PendingRequest` gains an additive field, the queue's public methods keep their signatures, and the new refusal path is a distinct return value rather than a change to `enqueue`'s success behaviour.

## Migration Plan

1. No stored-data migration is required. `PendingRequest` is an in-memory queue record, so the added signing-key field has no persistence implications. No settings, policy, or key schema changes.
2. Land the schema bounds and the shared timeout constant first; they are additive and independently testable.
3. Land the content script and injected-script changes together, because HTTPS-only matches, the removed unlock message, the frozen property, the aligned deadline, and the cancellation path are one coherent surface.
4. Update the Playwright fixture to HTTPS in the same commit as the match-pattern change, so the suite never sits in a state where provider tests silently pass without a provider.
5. Land the approval-UI changes last; they depend on `PendingRequest` carrying the bound signing key.
6. Coordinate with `harden-manifest-and-build` before enabling `use_dynamic_url`, and verify `injectScript` still resolves the injected resource afterwards.
7. Rollback is per decision. Restoring `http://*/*`, restoring the 30-second provider timer, or restoring bulk approve are each independent single-file reverts. The schema bounds and the frozen property descriptor are the two changes most likely to surface an unexpected dapp incompatibility, and both revert cleanly without touching stored data.

## Open Questions

- Should the HTTPS development certificate be checked into `tests/e2e/fixtures/` for reproducibility, or generated on demand in `globalSetup`? Checking it in is simpler and reproducible but puts a private key in the repository, even a development-only one for `localhost`.
- Should the `rate_limited` refusal be visible to the user at all, for example as an activity-log entry recording that an origin was throttled? Silent refusal gives an attacker no feedback, but it also hides abuse from the person who would want to revoke that site.
- Should the locked-vault badge state be visually distinct from the pending-approvals badge count, or should the pending count simply take precedence?
- Is `MAX_EVENT_TAGS = 5,000` the right ceiling for contact lists, or should kind `3` get a higher, kind-specific allowance?

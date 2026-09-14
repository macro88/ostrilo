# Changelog

## Unreleased

### Security

- **A failed unlock now tells you why.** Entering the wrong password at the lock
  screen used to clear the field and say nothing: the error was swallowed
  between the background and the screen, so every failure looked identical to a
  slow success. The screen now reports the reason the background gave — an
  incorrect password, a vault that does not exist yet, a vault written by a
  different version of Ostrilo, and how long you must wait when repeated failed
  attempts have paused unlocking.
- This is a behaviour change if you had learned to read the blank password field
  as failure. A blank field no longer means anything on its own; the message
  does.
- The same swallowed error meant the lock screen ran its success callback after a
  failed attempt. Both call sites happen to do nothing today, so no unlock was
  ever bypassed — but the next caller to give that callback real behaviour would
  have inherited a bypass.
- The attempt counter on the lock screen is gone. It was component state, so
  closing and reopening the popup reset it, and it imposed no delay. Rate
  limiting is enforced in the background, where it is not resettable and cannot
  be skipped by sending the message directly.
- The key import flow now clears the master password and its confirmation when
  the import succeeds, when it fails, and when the flow is left — matching the
  key creation flow. It previously rendered its success screen with both still
  held.
- Every password and private-key input is now withheld from browser autofill,
  third-party password managers and spell-check from one shared declaration.
  Three inputs were missing some or all of these attributes. These are advisory
  attributes and vendor conventions, not enforcement.
- On the options page and side panel, whose documents outlive an unlock attempt,
  the password input element's own value is cleared when the page is hidden and
  when the screen goes away. This drops the extension's reference to what you
  typed; it does not erase the string, which JavaScript cannot do.
- **The extension now lands locked after this update, and after every
  browser restart.** Lock state previously read `!!state?.isLocked`, which
  is `false` when no state is stored — the situation on every restart — so
  a vault that had never been opened reported itself unlocked and disclosed
  the user's public key to any page. It now fails closed. Expect to be
  asked for your password once after updating.
- Auto-lock is enforced for the first time. `autoLockMinutes` drove two
  sliders and a header label and nothing acted on it. It is now bounded to
  1–60 minutes (5 by default) and enforced by a `chrome.alarms` alarm plus
  a deadline checked on every access. A stored `0`, which used to read as
  "never lock", is now read as the shipped default.
- The RPC surface is lock-gated by an allowlist: a method is refused while
  locked unless it is explicitly listed, so a new method fails safe.
  `keys.list` and `settings.get` are redacted while locked.
- The options page renders the lock screen when the vault is locked, and
  transitions to it without a reload.
- Deleting a key, raising an origin to `high` trust, enabling a session
  grant, setting a per-kind `allow` rule, and changing either security
  timeout now require the password again, verified in the background.
- Pending approval requests are denied and the badge cleared when the vault
  locks.
- Requires the `alarms` permission. An MV3 service worker is evicted after
  ~30s idle and `setTimeout` does not survive that, so alarms are the only
  way auto-lock can fire at all.
- **The NIP-07 provider is no longer injected into `http://` pages.**
  BREAKING for dapps served over plaintext. On such a page an on-path
  attacker controls the document and can drive `window.nostr` as the origin
  the user trusts, which no approval dialog can detect. See
  `docs/local-https-development.md` for local development.
- `window.nostr` is defined non-writable and non-configurable, and the
  provider object and its methods are frozen, so a page script cannot
  replace `signEvent` and sit between the page and the signer.
- `nip04` and `nip44` are removed from the advertised surface. They were
  objects whose every method threw, so feature detection returned true and
  then failed at call time. **BREAKING** for anything feature-detecting them.
- Page-triggered unlock is removed. Any page could make the genuine master-
  password prompt appear on demand, unthrottled. A locked vault now answers
  `locked` and raises a toolbar marker the page cannot drive. **BREAKING**
  for the `openUnlockPrompt` runtime message.
- Event `content` and `tags` are bounded, measured in UTF-8 bytes, with a
  total serialized-event ceiling. Oversized payloads are refused with
  `invalid_event` before anything is hashed or queued.
- The approval dialog shows the full origin including scheme, flags a
  non-HTTPS origin, reports true payload byte lengths, and renders bidi and
  zero-width characters as visible escapes with a count. The signed bytes
  are never altered.
- "Signing as" is read from the key bound to the request at enqueue time,
  not from whichever key the approval UI had selected when it loaded.
- The approval queue is rate-limited per origin (10 per minute, 5 pending)
  and capped globally at 20. A flooding origin gets `rate_limited`.
- "Approve all from site" is removed; bulk deny remains. The detail pane no
  longer re-binds to the next queued request after a resolution, and approve
  is disabled for 500ms whenever it binds to a new request. **BREAKING** for
  the batch-approve affordance.
- The page-side and extension-side approval deadlines are aligned from one
  constant, and a page that gives up withdraws its request, so no signature
  is produced for a request nobody is waiting for. **BREAKING** for dapps
  depending on the old 30-second rejection.

### Other
- Added the browser extension options page for advanced settings, with tabs for General, Keys & Identities, Security, Permissions, Activity Log, Relays, and Advanced settings.
- Kept popup Settings focused on quick controls: active key, theme, auto-lock, and the Advanced Settings action.
- Added options page hardening around activity log export, relay URL validation, keyboard tab navigation, and local cross-context settings sync coverage.

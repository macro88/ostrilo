# Changelog

## Unreleased

### Security

- **BREAKING (RPC): `policy.setOrigin` accepts only `name`, `trustLevel` and
  `identityDisclosure`.** A patch carrying `rules`, `sessionGrantAll` or
  `updatedAt` is refused with `invalid_params`. Per-kind rules go through
  `policy.setKindRule` and session grants through `policy.setSession`, both of
  which already ask for the password where the value grants authority. The old
  patch let one message write `{ "0": "allow" }` for a site with no password at
  all. Setting `identityDisclosure: "allow"` through `setOrigin` now needs the
  password too, like `high` trust; tightening to `ask` or `deny` stays free.
- The background no longer believes the page origin a `nostr.*` message names.
  It derives the origin from the browser-attested sender - this extension's
  top-frame content script on an `https:` page - and refuses a request whose
  claimed origin disagrees with `invalid_origin`, before any service runs.
  Single-page apps that route with `history.pushState` are unaffected.
- Every master-password check now shares the unlock throttle: re-authentication
  for high-risk actions, revealing a key, and adding a key to an existing vault
  count against the same backoff as unlocking, and a correct password on any of
  them resets it. The password dialog shows a backoff as a wait with its
  remaining time instead of as an incorrect password.
- Unlocking an already-unlocked vault now zeroizes the private keys it replaces
  instead of dropping them unerased.
- Locking always denies pending approvals and clears the badge, even when the
  settings write during lock fails; the failure is still reported.
- KDF parameters read from the vault or from a backup file are bounded above as
  well as below, so a crafted file cannot stall the page that opens it with an
  enormous memory cost. An out-of-bounds backup fails with the same message as a
  wrong passphrase.
- The approval-window command answers only the extension's own pages; a web
  page can no longer raise it.

## 0.8.0 — 2026-09-25

First public release. There is no published predecessor, so the entries below
cover the whole of Ostrilo's development rather than a single release cycle —
which is why a first release arrives with a changelog this long. They were written as
the work landed, against the development builds in use at the time, so some are
phrased as changes to existing behaviour and address people already running
those builds; if this release is your first Ostrilo, read those as descriptions
of how 0.8.0 behaves. The README states what this version number does and does
not claim.

### Security

- **BREAKING for dApps: `window.nostr.getPublicKey()` now requires your
  consent, per site.** It previously answered any https page silently, as
  often as it was asked, while the vault was unlocked. A site with no decision
  on record now prompts you once; refusing rejects the call with
  `disclosure_refused`, which is a different code from the `denied` returned
  for a refused signature.
- **Every site will ask once after this update, including ones you already
  trust.** Nothing is grandfathered — not an explicit allow rule, not `high`
  trust. A stored record for a site is written whenever you make a signing
  decision about it, *including when you refuse*, so it is not evidence that
  you agreed to hand over your identity. Approving a signature does record
  disclosure consent, because a signed event contains your public key, so the
  sites you actually use converge without a second prompt.
- Your public key is **not a secret** — it is published on relays, and Ostrilo
  publishes it there itself. This is about *linkage*: which sites can tie your
  browsing to that identity. The gate protects the window before your first
  approved signature, and it protects sites that never ask for one. It does
  not isolate a third-party script inside a page you have consented to.
- `getPublicKey` is now rate limited per site. A page that polls in a loop —
  previously able to capture your key the moment you unlocked, with the
  auto-lock timeout no defence against it — now gets `rate_limited`.
- Every identity request is recorded in the activity log, and Settings →
  Permissions now lists which sites have read your public key. That list
  includes sites with no stored policy, which is the point: a script that only
  ever reads your identity and never asks to sign never appeared anywhere
  before.
- You can revoke a site's identity access in Settings → Permissions, and it
  will be asked again next time.
- Refusing identity disclosure for a site now forces its signing requests back
  to asking, overriding any remembered per-kind allow. Otherwise Settings would
  show a refusal the product did not enforce, since every signature hands over
  the public key anyway.
- The approval window has an error boundary. A request that could not be
  rendered used to blank the whole window, which removed the Deny control for
  every other queued request too.
- Fixed: resolving an approval for a request with no event returned
  `approval_failed` and left it queued until its 60-second auto-deny — but only
  for the Allow and Deny-and-remember buttons. The same request resolved fine
  through Allow-once and plain Deny, so it appeared to work or hang depending
  on which button was pressed.
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
- **The plaintext key download is gone.** "Download Backup" wrote
  `{name, privateKey, privateKeyHex, createdAt}` to disk in the clear, with no
  passphrase and no warning. If you ever used it, find that file and delete it,
  and read [the migration warning](docs/key-backup.md#if-you-used-an-earlier-development-build)
  before assuming deletion was enough. It is replaced by **Save encrypted
  backup**, which writes a versioned `ostrilo-key-backup` file sealed with the
  same Argon2id key derivation and AES-GCM encryption the vault itself uses.
  There is no plaintext option, not behind a confirmation.
- **The backup file has its own passphrase**, separate from your master
  password on purpose, so forgetting one password does not lose the vault and
  its backup together. Ostrilo cannot recover the backup passphrase.
- **Copying your key to the clipboard now expires** after 45 seconds, with a
  countdown and a "Clear now" button, and is cleared immediately if you leave or
  close the window. Ostrilo overwrites the clipboard without reading it, so it
  needs no clipboard permission — anything else you copy in those 45 seconds is
  replaced too. If the copy fails, the key is shown in grouped blocks to write
  down.
- **Finishing onboarding now requires proof you recorded the key.** Finish
  stays disabled until you re-enter the last 8 characters of your `nsec`, or
  re-open the encrypted backup file with its passphrase. This defeats accidental
  click-through; it cannot prove a key was written on paper, and does not claim
  to.
- **The revealed `nsec` is no longer displayed in a `type="password"` field**,
  which is the signal password managers capture on.
- **The 3D mascot and its WebGL engine are gone.** An 892 KB three.js library
  was reachable from every extension page, including the one that reveals your
  private key and the one that asks you to approve a signature. It is removed
  entirely, along with the `connect-src 'self'` allowance that existed only so
  it could fetch its model. A build check and a source check fail if a WebGL
  library ever comes back.
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
- **The auto-lock timeout now actually resets when you use the extension.** It
  was supposed to be measured from your last activity — the slider has always
  said so — but nothing recorded that activity, so the countdown ran from the
  moment you unlocked and never moved. Unlocking, switching keys, answering an
  approval and changing a setting now each postpone the lock.
- **This means an unlocked vault will stay open longer than it used to under
  active use.** That is the behaviour the setting always described, not a
  relaxation of it: an idle window still locks on schedule, and "idle" now means
  what it says. If you had come to rely on the vault locking a fixed time after
  unlock regardless of what you were doing, lower the timeout or use Lock now.
- Activity reports are throttled to one per surface every 30 seconds, so a burst
  of clicking does not wake the extension repeatedly. The practical effect is
  that the lock can fire up to 30 seconds earlier than your very last action.
- **A ring beside the auto-lock slider shows how long the vault has left.** It
  appears on the Options Security tab, in the popup Settings panel, and around
  the lock button in the popup and side panel header. Under a minute it switches
  to seconds and turns red.
- The countdown is a readout only. It cannot extend your session, cannot end it,
  and does not itself lock anything — the background decides that, and the ring
  follows within a few seconds if the two ever disagree. Displaying it records no
  activity, so leaving a window open with the countdown on screen does not keep
  your vault unlocked.
- There is deliberately no countdown on the approval window. The clock there is
  the one on the request you are being asked to sign.
- The time remaining is never given to a web page, and a locked vault reports no
  deadline at all — so nothing discloses when your previous session ended.
- **Signing from a site now counts as activity, but only while you are at your
  computer.** Reacting to a post is signed without a prompt once you trust a
  site, so a user working through a feed was generating nothing the extension
  counted — react, read for six minutes, and the next reaction failed on a
  locked vault. Signatures now postpone the lock the way using the extension
  does.
- **A site cannot keep your vault unlocked on its own.** The postponement
  requires that your computer has had keyboard or mouse input during the
  timeout window. Walk away and a client publishing on a timer in a pinned tab
  will not hold the session open — it locks on schedule, and the next request
  is refused until you unlock.
- A locked screensaver or OS lock screen counts as away, not as present.
- **This means an unlocked vault stays open longer while you are at your desk.**
  If you sit at your machine with a Nostr client open in a background tab, the
  vault will not time out. That is the intended trade — the timeout exists to
  bound a vault nobody is watching — but it is a real change from locking five
  minutes after you last touched the extension.
- **New permission: `idle`.** It reports one of three words about whether your
  computer has had recent input — active, idle, or locked — and nothing else.
  It is what separates you being there from a page being busy. It does not
  reveal what you type, which application you are using, or what is on screen.

### Other
- Added a [privacy policy](PRIVACY.md) covering what the extension stores, what it sends to relays, and which settings browser sync copies.
- Added the browser extension options page for advanced settings, with tabs for General, Keys & Identities, Security, Permissions, Activity Log, Relays, and Advanced settings.
- Kept popup Settings focused on quick controls: active key, theme, auto-lock, and the Advanced Settings action.
- Added options page hardening around activity log export, relay URL validation, keyboard tab navigation, and local cross-context settings sync coverage.

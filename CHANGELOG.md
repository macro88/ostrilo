# Changelog

## Unreleased

### Security

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
### Other

- Added the browser extension options page for advanced settings, with tabs for General, Keys & Identities, Security, Permissions, Activity Log, Relays, and Advanced settings.
- Kept popup Settings focused on quick controls: active key, theme, auto-lock, and the Advanced Settings action.
- Added options page hardening around activity log export, relay URL validation, keyboard tab navigation, and local cross-context settings sync coverage.

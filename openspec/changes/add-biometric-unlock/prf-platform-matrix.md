# PRF platform matrix

Measurements for task group 1, taken with the harness in `spike/` (extension
identifier `dekpcojmghilnlhgbjhcmlmjhhlchbpl`, RP ID omitted, so the relying
party is the extension origin). Incomplete: rows marked *pending* have not been
run, and no verdict against the kill criterion is recorded until they have.

## Authenticators

| Row | Date | Browser | Result | `prf.enabled` at create | 32 bytes at get | Stable across gets | UV=discouraged | Backup eligible / state | Algorithm |
|---|---|---|---|---|---|---|---|---|---|
| macOS 26.6.2, Apple Passwords (iCloud Keychain) | 2026-11-21 | Chrome 158 | Works | true | yes | yes | Same output, but `userVerified: true` — the authenticator verified anyway | true / true | ES256 (RS256 also offered) |
| macOS 26.6.2, 1Password as passkey provider | 2026-11-21 | Chrome 158 | **Refused**: "Unable to save passkey" for `chrome-extension://…` | — | — | — | — | — | — |
| macOS, Google Password Manager | | | *pending* | | | | | | |
| macOS, no provider configured | | | *pending* | | | | | | |
| Windows 11, Windows Hello | | | *pending* | | | | | | |
| Linux, Google Password Manager | | | *pending* | | | | | | |
| ChromeOS | | | *pending* | | | | | | |
| CTAP2 security key | | | *pending* | | | | | | |

Notes on the Apple Passwords row:

- PRF output is not returned at create (`prfResultsAtCreate: false`); the
  create-then-get enrolment in task 6.3 is required, not optional.
- The credential is a synced passkey. Transports were `["hybrid", "internal"]`.
- Assertions took 5.1–5.6 s wall clock including the Touch ID prompt, from a
  foreground options tab. This is not the task 1.5 timing, which measures the
  whole daily flow against typing the password.
- Whether a verification prompt was shown for the UV=discouraged assertion was
  not noted; the flag says verification happened.

Notes on the 1Password row:

- The failure is in the provider, after the user picks it. The user is not
  returned to Chrome's chooser; `create()` has to be started again.
- Design consequence: a third-party provider can be the first thing a user
  picks and it can refuse the extension origin. Enrolment needs a failure state
  that names the providers known to work.

## The extension itself

On 2026-11-25 the production build of the extension (pinned identifier
`nhodljdjlljpapclgcjmhajpgodanchk`, loaded unpacked) was enrolled and unlocked
with Apple Passwords and Touch ID on macOS 26.6.2, Chrome 158: Turn on in
Settings, lock, `Unlock with your device`. Reported working by the owner; no
log was captured. 1Password still refused to save the passkey, now for the
published identifier, so the refusal does not depend on which identifier the
extension has.

## Hosts

| Host | Starts | Completes |
|---|---|---|
| Foreground options tab | yes | yes (Apple Passwords, macOS 26.6.2, Chrome 158) |
| `windows.create` window (`type: "popup"`) | yes | yes (Apple Passwords, macOS 26.6.2, Chrome 158, 2026-11-25; 32 bytes, 5.6 s including Touch ID) |
| Background options tab | *pending* | |
| Action popup | yes | yes (Apple Passwords, macOS 26.6.2, Chrome 158, 2026-11-25; popup stayed open through Touch ID, same 32 bytes, 5.2 s). Not yet known for Windows Hello or Google Password Manager, whose prompts may take focus and close the popup |
| Side panel | yes | yes (Apple Passwords, macOS 26.6.2, Chrome 158, 2026-11-25; same 32 bytes, 5.1 s). The third-party report of side-panel prompts hanging did not reproduce here |

## Deleted credential

| Class | Date | What the user sees | What the page sees |
|---|---|---|---|
| Apple Passwords, macOS 26.6.2, Chrome 158 | 2026-11-25 | Chrome's "Use your phone or tablet" QR prompt, because the credential's transports include `hybrid` | `NotAllowedError` after the prompt is dismissed (8.4 s and 10.8 s); identical to a cancelled Touch ID prompt |

A deleted credential cannot be told apart from a cancel. See `design.md` Open
Questions for the consequence. Other classes *pending*.

## Verdict

**Proceed, with Windows unmeasured** (2026-11-25).

Against the kill criterion in `proposal.md`:

- The only macOS authenticator measured is a synced passkey provider, the
  expected result. The change ships with the synced-credential disclosure
  leading the enable-time copy.
- No measured class returns the enrolled output without user verification.
- The options tab hosts enrolment and a created window hosts unlock.

Development proceeds on the assumption that Windows Hello behaves the same.
That assumption is safe to build on because nothing in the design is
Windows-specific: the unlock host is the created window, which Chrome permits
on every platform, and enrolment proves a live create-then-get round trip
before it writes anything, so an authenticator that cannot deliver fails at
enrolment rather than later. It is not safe to release on. Before the feature
is announced as working on Windows, the Windows 11 / Windows Hello row and its
UV=discouraged check must be filled in; if that row leaks output without
verification, Windows Hello is excluded.

The popup and side panel also hosted the ceremony on macOS. Moving unlock out
of the created window and into the popup is a possible later simplification,
and needs the Windows popup result first.

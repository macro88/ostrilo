# Security Policy

Ostrilo holds Nostr private keys. A flaw here can cost someone an identity
permanently: there is no account-recovery service, and losing every usable copy
of a private key loses the identity. Security reports are welcome and are
treated as the highest-priority work in this repository.

> **Never put key material in a report.** No `nsec`, no hex private key, no
> passphrase, no vault file, no unredacted backup file, and no screenshot
> containing any of those. Reproduce with a throwaway test identity and say that
> is what you used. A report containing a real secret will be treated as a
> compromised key: rotate it yourself, immediately.

## Where to report

Report privately through **GitHub Private Vulnerability Reporting**:

**https://github.com/macro88/ostrilo/security/advisories/new**

That form opens a draft security advisory visible only to you and the
maintainer. It is the only private channel this project has. Ostrilo is
maintained pseudonymously as `macro88`; no email address is published, and the
advisory form exists precisely so that none is needed.

Private vulnerability reporting is a repository setting rather than a file in
this checkout, so this document cannot confirm from the source tree that it is
switched on. If the link above returns a 404, or shows no form for submitting a
report, the setting has not been enabled yet.

In that case, do not fall back to the issue tracker. Blank issues are disabled,
and the one issue form that exists requires you to affirm that what you are
filing is *not* a security vulnerability, so there is deliberately no public
route for this. Hold the details — no summary, no proof of concept, no affected
file or function names — and check the advisory link again; enabling the setting
is a single change in repository settings and costs the maintainer nothing.
Send anything substantive only once the private advisory is open.

If the channel stays closed and you believe its absence is itself leaving users
at risk, GitHub's own reporting tools at <https://github.com/contact/report-abuse>
reach GitHub rather than the maintainer and depend on nothing configured in this
repository.

Do not open a public issue, pull request or discussion containing vulnerability
details, and do not publish them elsewhere, until the process in
[What happens to your report](#what-happens-to-your-report) has run.

A good report contains: the browser and version, the source revision you built
(a commit SHA), the build target (`pnpm run build` or `pnpm run build:firefox`),
numbered reproduction steps, what you expected, and what happened instead.

## What is in scope

Scope follows the boundaries the README's
[trust and control](README.md#trust-and-control) table already states. Ostrilo
is at version `1.0.0`, built from source; there is no store release yet and no
maintained release branch, so reports are assessed against the current
`main`. Chromium is the automated extension-test target and Firefox has a
dedicated MV3 build without equivalent browser-runtime coverage; a
Firefox-specific finding is in scope, so state the browser. Safari is not a
verified target.

In scope:

- **Private key material leaving the extension's background context.** Signing
  happens in the background; websites receive public keys and signed events,
  never a private key. Any path that returns a plaintext key or passphrase to a
  page, content script, injected provider, or a shipped bundle is in scope.
  See the *Keys in use* row of the trust table and the
  [provider boundary](src/extension/content.ts).
- **Weaknesses in vault encryption at rest.** Private keys are encrypted in
  local extension storage with AES-GCM; new vaults use Argon2id, and versioned
  records carry their derivation parameters. Breaking that, or forcing a record
  to weaker parameters, is in scope. See the *Keys at rest* row and the
  [vault format](docs/vault-storage-format.md).
- **Bypassing the public-key consent gate.** `getPublicKey` requires per-origin
  consent, including for high-trust sites; refusal is remembered, and requests
  are rate limited and logged. Obtaining a public key without consent, defeating
  a remembered refusal, or evading the rate limit is in scope. See the
  *Public identity* row.
- **Obtaining a signature that policy should have refused.** Protected kinds
  always require approval: text notes, deletion requests, zap requests, relay
  authentication and HTTP authentication. Getting one of those signed without a
  prompt, escaping a per-site trust level or per-kind rule, or causing the
  approval prompt to display something other than what would be signed, is in
  scope. See the *Signing authority* row and the
  [policy definitions](src/domain/policy/trust-definitions.ts).
- **Lock and re-authentication bypass.** Reaching key material while the vault
  is locked, defeating auto-lock, or completing an action that requires password
  re-verification — deletion, high-trust grants, signing-session grants,
  security-timeout changes — without it. See the *Locking* row.
- **Privilege escalation across the RPC boundary.** A page or content script
  reaching extension-privileged RPC methods it should not be able to call.
- **Untrusted remote data.** A malicious relay response, cached profile or
  profile image that causes code execution, key exposure, or persistent
  corruption of the vault. Disclosure *to* relays is expected behaviour; see
  out of scope below.
- **Manifest and build integrity.** Permissions requested beyond storage,
  windows, alarms and idle access (plus the Chromium side panel), remote code
  loading, or a weakened Content Security Policy. Inspect
  [the manifest configuration](wxt.config.ts).
- **Secret leakage into records.** A private key or passphrase appearing in
  logs, in the JSON activity export, or in a built bundle.

## What is out of scope

The three cases below are documented, accepted trade-offs rather than defects.
They are stated here so that neither side spends time re-triaging them; a report
about one of them will be closed with a pointer to this section.

1. **A compromised device with an unlocked vault.** You still trust the
   installed extension, its dependencies, your browser and your operating
   system. An encrypted vault does not protect an unlocked session from a
   compromised device, and nothing in this design claims otherwise.
2. **A third-party script inside a page the user has already consented to.**
   Third-party scripts running in an approved page share that page's origin and
   its grant, and consent cannot distinguish them from the site itself. The
   public-key gate limits identity *linkage*; it is not a same-origin
   replacement.
3. **Plaintext-key reveal through the deliberate backup flow.** A deliberate key
   reveal returns plaintext to the extension's backup UI after password
   verification, and JavaScript strings and clipboard history cannot be reliably
   erased. That the plaintext is then observable in the UI or the clipboard is
   the intended behaviour of that flow. The separate, retired **Download Backup**
   flow that wrote unencrypted secret keys to a file is already disclosed in the
   [plaintext-backup migration warning](docs/key-backup.md#if-you-used-an-earlier-development-build);
   it is a known issue, not a new finding.

Also already documented, and likewise not new findings:

- **Relay and profile-host disclosure.** Profile requests disclose a public key
  to configured relays, and profile images can contact their hosts. Profile
  publication and optional image uploads also leave the device. These operations
  are not anonymous, and the README says so.
- **Local records are not an encrypted personal-data vault.** Settings, public
  metadata and activity history are stored unencrypted, and activity can reveal
  which sites used an identity. Only private keys are encrypted at rest.
- **Absent NIP-07 methods.** `getRelays`, `nip04.*` and `nip44.*` are
  deliberately not implemented so that applications can detect their absence.
  Missing functionality is not a vulnerability.
- **A dependency advisory with no demonstrated path to shipped extension code.**
  The audit threshold and any accepted exceptions are recorded in
  [CI verification](docs/ci-verification.md). A scanner's raw output is not by
  itself a report; show the path to user impact.

## How fast you will get a response

Ostrilo is maintained by one pseudonymous maintainer, in their own time. There
is no service level agreement, and inventing one here would be a promise this
project cannot keep.

What you can rely on instead: reports are handled on a **best-effort basis, with
security taking priority over everything else in the repository**. Expect an
acknowledgement within a few days rather than within hours. If you have heard
nothing after **14 days**, assume the report did not reach anyone rather than
that it was ignored — add a comment to your own draft advisory to raise it.

There is no bug bounty and no payment.

## What happens to your report

1. **Acknowledged.** You are told the report arrived, and whether it is
   understood and reproducible or whether more information is needed.
2. **Triaged.** The report is assessed against the scope above. Severity is
   judged by what it costs the user's keys and identity, not by a score alone.
   If it is out of scope, you are told which documented boundary it falls under
   and why.
3. **Fixed before public disclosure where possible.** The intended sequence is:
   fix on `main`, add a regression test to the security suite in
   `tests/security/`, then publish the advisory and a
   [CHANGELOG](CHANGELOG.md) entry describing the issue and its impact. Where a
   fix will take time, you are told where it stands rather than left in silence.
   Disclosure timing is coordinated with you; if an issue is already public or
   being exploited, speed takes priority over coordination.
4. **Credited if you want to be.** You choose: credited in the advisory and the
   changelog under whatever name or handle you give, or not mentioned at all.
   You are asked before anything is published, and you are never required to
   supply a real name or an email address to receive credit.

This policy asks for no embargo beyond the time needed to ship a fix. If the
maintainer goes quiet and you have waited a reasonable period, disclosing is
your call — an unanswered report is the maintainer's failure, not yours.

## Related documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, the verification gate, and the
  change workflow.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — conduct expectations and how
  conduct reports are handled.
- [Trust and control](README.md#trust-and-control) — the boundary table this
  policy draws its scope from.

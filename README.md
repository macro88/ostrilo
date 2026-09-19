<p align="center">
  <img src="src/assets/icon.png" alt="Ostrilo — a purple, faceted ostrich" width="144" height="144">
</p>

<h1 align="center">Ostrilo</h1>

<p align="center">
  <strong>Your Nostr keys. Your signing decisions.</strong><br>
  A browser extension for managing identities and signing Nostr events locally.
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-works-today">Current status</a> ·
  <a href="#trust-and-control">Trust &amp; control</a> ·
  <a href="#backup-recovery-and-exit">Recovery</a> ·
  <a href="#contributing">Contribute</a>
</p>

---

Ostrilo lets Nostr websites ask for your public key and request signatures through
`window.nostr`. Keep several identities in one local vault, choose the active key,
and manage each site's permissions. Signing happens in the extension's background
context; websites receive public keys and signed events, never your private key.

> **Development version · 0.0.1**
> Chromium is the automated extension-test target. Firefox has a dedicated MV3
> build; that does not establish equivalent browser-runtime coverage. Safari is
> not a verified target. The instructions below build from source, rather than
> install a store release. Start with a disposable identity while evaluating it.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/design-review/screenshots/dark/23-popup-home-populated.png">
    <img src="docs/design-review/screenshots/23-popup-home-populated.png" alt="Ostrilo home with two keys, three relays, three site permissions, and signed and denied activity" width="320">
  </picture>
</p>

A populated test vault, captured from the production build in the
[September 2026 design review](docs/design-review/README.md). These are existing
review captures, not a live demonstration or a new security assessment.

## What works today

- **Multiple identities:** generate or import keys, select the signing identity,
  rename keys, and delete them after password re-verification.
- **Site consent:** decide which origins may learn your public key; approve or
  deny signing requests, with per-site trust levels and per-kind rules.
- **Local vault:** encrypted private-key storage, manual locking, and configurable
  auto-lock. Sensitive actions require the password again.
- **Profiles and relays:** fetch, cache and publish profile metadata through
  configurable relays. Manage these alongside keys and permissions in the full-tab
  options page.
- **Activity:** inspect signing and disclosure decisions, filter the log, and
  export activity as a local JSON file.

The website provider implements **`getPublicKey` and `signEvent` only**.
`getRelays`, `nip04.*` and `nip44.*` are absent, so applications can detect that
those features are unavailable. Remote signing, seed phrases and multi-device
sync are roadmap work; the [requirements](docs/v2-prd.md) are not a list of shipped
capabilities.

## Get started

Use **Node.js 22** (the CI major version) and **pnpm 11.5.2** (pinned in
`package.json`). You will also need Git and a desktop browser.

```sh
git clone https://github.com/macro88/ostrilo.git
cd ostrilo
pnpm install --frozen-lockfile
pnpm run build
```

### Chromium

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output/chrome-mv3` inside your checkout. Pin Ostrilo and open its
popup to begin onboarding.

### Firefox

```sh
pnpm run build:firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
and select `.output/firefox-mv3/manifest.json`. This is a development installation;
temporary add-ons are removed when Firefox restarts. Keep backups outside it.

### First use

1. Create a test identity or import a test `nsec`, then set your vault password.
2. If creating an identity during onboarding, record the key or save an encrypted
   backup. Complete the backup verification before finishing.
3. Open a Nostr website that supports a browser signer, over **HTTPS**, and choose
   its extension sign-in option. Review Ostrilo's public-key consent prompt.
4. Review a signing request in Ostrilo. Check the origin, active identity, event
   kind and payload before approving; inspect the result in Activity.

Settings contains quick controls and **Advanced Settings**, which opens the full
options page. Use Permissions to review site access and Relays to change relay
endpoints. The provider runs only in top-level HTTPS pages; local development
needs the [HTTPS test setup](docs/local-https-development.md).

For extension development, `pnpm run dev` and `pnpm run dev:firefox` start WXT's
respective development modes. Judge release behavior using a production build.
See the [agent loop](docs/agent-loop.md) for a repeatable signing journey.

## Trust and control

Ostrilo separates website requests, extension messaging, policy decisions and
background signing. You still trust the installed extension, its dependencies,
your browser and operating system. An encrypted vault does not protect an
unlocked session from a compromised device.

| Boundary | Current behavior and limits |
| --- | --- |
| Keys at rest | Private keys are encrypted in local extension storage with AES-GCM. New vaults use Argon2id; versioned records carry their derivation parameters. See the [vault format](docs/vault-storage-format.md) for legacy migration and validation. |
| Keys in use | Background code performs signing. Deliberate key reveal returns plaintext to the extension's backup UI after password verification. JavaScript strings and clipboard history cannot be reliably erased. |
| Public identity | `getPublicKey` requires per-origin consent, including for high-trust sites. Refusal is remembered; requests are rate limited and logged. Approving a signature also records disclosure consent because the event contains the public key. |
| Signing authority | Trust levels and explicit rules can allow some events without a prompt. Protected kinds always require approval: text notes, deletion requests, zap requests, relay authentication and HTTP authentication. See the [policy definitions](src/domain/policy/trust-definitions.ts). |
| Locking | Auto-lock uses browser alarms and an access-time deadline check. Password re-verification protects deletion, high-trust grants, signing-session grants and security-timeout changes. |
| Network | Profile requests disclose a public key to configured relays; profile images can contact their hosts. Profile publication and optional image uploads also leave the device. These operations are not anonymous. |
| Local records | Settings, public metadata and activity history are not an encrypted personal-data vault. Activity can reveal which sites used an identity. |

The public-key gate limits **identity linkage**, not public-key visibility on Nostr.
Third-party scripts running inside an approved page share that page's origin and
its grant. Consent cannot distinguish them from the site itself.

The manifest requests storage, windows, alarms and idle access; Chromium also uses
a side panel. Idle signals help distinguish human presence from page activity;
alarms enforce locking across background-worker termination. Inspect
[the manifest configuration](wxt.config.ts) and
[provider boundary](src/extension/content.ts) for the actual permission surface.

### Website integration

Check for `window.nostr` and the individual method before using it. Handle refusals
and locked-vault errors rather than retrying indefinitely. A refused public-key
request returns `disclosure_refused`; a refused signature returns `denied`;
excessive requests can return `rate_limited`. See the
[RPC error reference](docs/rpc-error-codes.md) and
[provider implementation](src/extension/injected.ts).

## Backup, recovery and exit

**Back up before relying on an identity.** Losing every usable copy of the private
key loses the identity. Ostrilo has no account-recovery service.

During new-key onboarding, **Save encrypted backup** creates a versioned
`ostrilo-key-backup` file with a separate backup passphrase. To restore in a fresh
installation, choose the file in onboarding's import step, enter that passphrase,
and set the new vault password. Verify the restored public key before relying on
it. The repository includes [backup tests](tests/unit/ui/features/onboarding/key-backup-envelope.test.ts)
and a [backup flow guide](docs/release-notes-secure-key-backup.md).

- **Keep the passphrase separately.** An encrypted backup cannot help if you lose
  its passphrase too. A clipboard copy is not a durable backup.
- **Check which flow you used.** The encrypted-file workflow is in onboarding.
  Keys created later through Settings do not get that backup step, and the
  Settings key list has no export control. Preserve an independent copy of
  imported keys; avoid relying on later-generated keys without a recovery path.
- **Move identities with `nsec`.** A client that accepts the same Nostr private key
  can use the identity. Ostrilo's encrypted backup format is application-specific;
  other signers are not promised to import it.
- **Data is separate from identity.** A key backup does not include site permissions,
  settings, cached profiles or activity. The JSON activity export is not a full-vault
  restore format. Whole-vault migration and synchronized installations are not
  established workflows.
- **Choose services or maintain a fork.** Relay endpoints are configurable. The
  source and MIT license allow independent builds and modifications; package
  registries, browser tooling and distribution rules remain dependencies.

If you used an older **Download Backup** flow, read the
[plaintext-backup migration warning](docs/release-notes-secure-key-backup.md#act-on-this-if-you-used-an-earlier-build).
Those files contained unencrypted secret keys; deleting one does not remove copies
from cloud sync, backups or other devices.

## Verify the work

The repository has unit, integration, security and Chromium extension tests.
Run the checks against the revision you intend to use; a README is not a current
pass certificate.

```sh
pnpm run compile
pnpm run lint
pnpm run test
pnpm run test:build-output
pnpm audit --audit-level high
pnpm exec playwright install chromium
pnpm run test:e2e
```

`test:build-output` builds both browser targets and checks their manifests and
key-handling bundles. E2E tests run separately from the core verification gate.
See [testing](docs/TESTING.md) and [CI verification](docs/ci-verification.md) for
scope and required checks. These tests are development evidence, not an independent
security audit or proof of bit-for-bit reproducible releases.

## Contributing

Start with the [development standards](docs/development-standards.md),
[architecture](docs/architecture_primer.md) and
[developer guide](docs/developers_readme.md). Keep cryptography behind the existing
ports and adapters, and follow the [Inkline design rules](docs/design/DESIGN_RULES.md)
for UI work.

Bug reports should include the browser, source revision, reproduction steps and
expected result, with keys and personal data removed. Documentation corrections,
accessibility findings and tests for refusal, locking and recovery are useful
contributions. Keep roadmap intentions separate from verified behavior.

After code edits, run the pinned `pnpm run doctor` and `pnpm run slop:changes` in
addition to the required verification checks. Fix findings without weakening
rules. Maintainers review proposed changes; no separate governance or release
signing policy is documented here.

A dedicated private vulnerability-reporting channel is not documented in this
checkout. Do not put private keys or sensitive exploit details in public issues.

## License

[MIT](LICENSE) · Copyright © 2026 Ostrilo contributors.
Third-party dependencies retain their own license terms.

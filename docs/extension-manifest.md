# Extension Manifest Policy

What Ostrilo's generated manifests declare, and why each declaration is what it
is. Companion to `docs/ci-verification.md`, which covers the CI gates and the
reproducible-build procedure.

Established by the OpenSpec change `harden-manifest-and-build`.

## Where the manifest comes from

There is no checked-in `manifest.json`. WXT generates one per target from
`wxt.config.ts` plus the entrypoints in `src/extension/`, and writes it to
`.output/<target>/manifest.json`.

That indirection is the reason this document exists. Two of the most
security-relevant keys are not in `wxt.config.ts` at all:

- `permissions` contains `sidePanel` on Chrome because WXT adds it for any MV3
  build with a sidepanel entrypoint.
- `sidebar_action` on Firefox is built from `<meta name="manifest.*">` tags read
  out of `src/extension/sidepanel/index.html`.

The second one shipped broken. The scaffold WXT generates carries
`<title>Default Side Panel Title</title>` and three placeholder meta tags, and
WXT copied them into the Firefox manifest verbatim, producing
`"browser_style": "true|false"` and a `default_icon` that was a JavaScript
object literal serialised to a string, ellipsis included. Nothing read the
generated file, so nobody noticed.

So: **assert on the generated manifest, never on the config.**
`tests/security/manifest-assertions.test.ts` does exactly that.

## Build targets

| Target | Output directory | Manifest version | Background |
|---|---|---|---|
| Chrome / Chromium | `.output/chrome-mv3` | 3 | service worker |
| Firefox | `.output/firefox-mv3` | 3 | non-persistent event page |

Firefox was MV2 until this change. WXT's default is MV2 for Firefox, so
`manifestVersion: 3` in `wxt.config.ts` is an explicit override that applies to
both targets.

**Why MV3 on Firefox.** An MV2 background page is persistent. `KeyVaultService`
holds decrypted key material in background memory, so under MV2 that material
lived as long as the browser process — there was no idle eviction, and the only
thing bounding key lifetime was application code that had to be correct. Chrome
MV3 already suspends its service worker after roughly 30 seconds idle, which
incidentally dropped those keys; Firefox got no such guarantee. MV3 makes
suspension a platform property on both targets, so `implement-session-auto-lock`
reasons about one lifecycle instead of two.

MV3 also unifies two manifest shapes that used to diverge: the CSP lands as
`content_security_policy.extension_pages` on both targets rather than being
flattened to an MV2 string on one, and `web_accessible_resources` stays in
object form, which is the only form that can express `use_dynamic_url`.

The documented fallback, if Firefox MV3 ever surfaces a blocker, is MV2 with
`background.persistent: false`. That keeps the key-lifetime benefit and loses
the rest. The manifest assertion test accepts either shape and rejects a
persistent page on any target.

**Consequence to keep in mind.** Module-scope state in
`src/extension/background.ts` — `approvalWindowId` and
`approvalWindowOperation` — does not survive background suspension. This is not
new: Chrome MV3 already imposed it, so any bug there was already latent. Firefox
now shares the constraint rather than masking it.

## Content security policy

Declared once in `wxt.config.ts` as `EXTENSION_PAGES_CSP` and emitted to both
targets:

```
default-src 'self';
script-src 'self';
object-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' wss: https://nostr.build;
font-src 'self';
frame-src 'none';
base-uri 'none';
form-action 'none'
```

On MV3 this governs the background context as well as the extension pages, so
`connect-src` constrains relay WebSockets too.

| Directive | Why this value |
|---|---|
| `default-src 'self'` | Closed fallback, so a directive nobody thought of does not silently default to permissive. |
| `script-src 'self'` | Bundled code only. No `'unsafe-eval'`, no `'unsafe-inline'`, no remote origin. Nothing in `src/` calls `eval` or `new Function`, and there is no WebAssembly, so `'wasm-unsafe-eval'` — which Chrome's own default policy includes — is deliberately omitted. |
| `object-src 'self'` | No plugin content. Both Chrome and the AMO validator expect the directive present and restrictive. |
| `style-src 'self' 'unsafe-inline'` | **Load-bearing.** `react-style-singleton`, reached through `react-remove-scroll` and therefore through every Radix dialog, creates a `<style>` element at runtime. Without `'unsafe-inline'` dialogs lose scroll-lock styling — with no error. Injected CSS is not a script-execution vector and the extension pages have no untrusted CSS source, so the cost is bounded. |
| `img-src 'self' data: https:` | The Profile page loads the user's own `profile.picture` once, on a save or Refresh picture, to make the local copy the header shows (`cache-own-profile-picture`). That address is arbitrary and cannot be enumerated, so `https:` is the narrowest source that fits; it excludes plaintext `http:`, so the load cannot be cleartext. `data:` carries that stored copy, plus small inlined images and QR rendering. No other surface renders a remote image: the application layer enforces that, and this directive is the backstop. |
| `connect-src wss: https://nostr.build` | No `'self'`: nothing in an extension page fetches a bundled file, so the extension origin is not a network destination. `https://nostr.build` is the hardcoded profile-image upload host. `wss:` is discussed below. `tests/security/manifest-assertions.test.ts` asserts this directive exactly, so any widening fails. |
| `font-src 'self'` | Archivo and JetBrains Mono are bundled from `@fontsource` and served from the extension itself. No Google Fonts, no remote `@import url(...)`. Fonts are never inlined as `data:` URIs (`assetsInlineLimit` in `wxt.config.ts`), so this directive needs no `data:` source. |
| `frame-src 'none'` | The extension embeds no iframes. |
| `base-uri 'none'` | No `<base>` element is needed, and closing it removes a class of injection escalation. |
| `form-action 'none'` | Both `<form>` elements submit through React `onSubmit` handlers and never navigate. |

### On `wss:`, stated plainly

A static manifest cannot enumerate relay hosts. Relays are user data: there are
defaults, there are preset bundles, and the relay settings screen accepts any
`wss://` URL the user types. So `wss:` is a scheme wildcard, and **any WebSocket
host the user configures is reachable.**

What that still buys: plaintext `ws:` is forbidden, so a relay entry can never be
downgraded to an unencrypted socket; `http:` is forbidden; and combined with the
single `https://nostr.build` entry, the only non-relay HTTPS destination an
extension page may reach is the one upload host. A compromised dependency cannot
open an arbitrary HTTPS exfiltration channel. The wildcard is confined to one
scheme on one directive.

### A silent failure mode

`style-src 'unsafe-inline'` fails *silently* when removed: a dialog loses its
scroll lock, and nothing throws. Production builds also drop `console` output,
so it would not log in a shipped build either.

It is asserted positively in `tests/security/manifest-assertions.test.ts` — the
test fails if the source is *removed*, not only if something looser is added —
and annotated in `wxt.config.ts`. Do not tighten it without re-running the page
smoke below.

### Chrome enforces two policies at once

Loading an extension page and listening for `securitypolicyviolation` shows each
violation reported twice: once against the declared policy and once against
Chrome's built-in extension default (`script-src 'self' 'wasm-unsafe-eval'
'inline-speculation-rules' ...`). Both are enforced. A declared policy can only
be *stricter* than the platform default, never looser, which is worth knowing
before trying to relax a directive to fix something.

## Permissions

Reviewed set, per target:

| Permission | Chrome | Firefox | Why |
|---|---|---|---|
| `storage` | yes | yes | `storage.local` holds the encrypted vault, the unlock throttle and the activity log; `storage.session` holds the lock state and session grants; `storage.local` also holds the `appSettings` item - origin policies, relays, security timeouts and preferences - owned by `SettingsStore`. `storage.sync` holds only the `isDocked` flag: a value browser sync can deliver from another device must not be able to grant authority, and `tests/security/settings-locality.test.ts` fails on any other use of it. `SettingsStore.migrate()` moves a pre-upgrade `appSettings` out of sync and then deletes the synced copy. |
| `windows` | yes | yes | The approval window: create, focus, close, and `windows.onRemoved`. Six call sites. |
| `sidePanel` | yes | no | `chrome.sidePanel.setPanelBehavior/setOptions/open` are called and Chrome requires the permission. It is **not** listed in `wxt.config.ts`: WXT adds it automatically for MV3 sidepanel entrypoints on Chromium. Listing it explicitly is what leaked `"sidePanel"` into the Firefox manifest, where it is not a valid permission name. Firefox uses `sidebar_action`, which needs no permission. |
| `alarms` | yes | yes | The auto-lock deadline. A `setTimeout` does not survive MV3 worker eviction; an alarm does, and wakes the worker to run the lock check (`AUTO_LOCK_ALARM` in `background.ts`). |
| `idle` | yes | yes | `idle.queryState` answers whether a user is at the machine, for the one path that asks: a signature produced without a prompt, asking to postpone the auto-lock deadline (`UserPresenceService`). |

No `host_permissions` on either target, and none should appear: the content
script's own `matches` grant what the extension needs. WXT only injects host
permissions in serve mode.

### Firefox data collection declaration

The Firefox manifest carries, under `browser_specific_settings.gecko`:

```json
"data_collection_permissions": { "required": ["none"] }
```

AMO requires this declaration of every new submission since 3 November 2025,
and surfaces it to the user at install time as the add-on's data consent. `none`
is the declaration that the extension collects and transmits no user data, which
is what [PRIVACY.md](../PRIVACY.md) states: no server, no telemetry, no crash
reports. Relay traffic is user-directed and is not collection in Mozilla's
sense. The assertion suite fails the Firefox manifest on any value other than
`["none"]`, and fails the Chrome manifest if the Firefox-only block appears
there. Adding a collected category is a privacy-policy change first and a
manifest change second.

## Web-accessible resources and the injection surface

```jsonc
"web_accessible_resources": [
  {
    "resources": ["injected.js"],
    "matches": ["http://*/*", "https://*/*"],
    "use_dynamic_url": true   // Chrome only
  }
]
```

`use_dynamic_url` makes Chrome serve the resource under a per-session GUID
instead of a path under the stable extension id. Without it, any page could
fetch a fixed `chrome-extension://<id>/injected.js` and learn that the user runs
a Nostr signer — and for a signer the leaked bit is not "runs an extension" but
"holds Nostr keys", which is a targeting signal.

Nothing holds a hardcoded resource URL: `content.ts` calls WXT's
`injectScript("/injected.js")`, which resolves through `browser.runtime.getURL`,
and that returns the dynamic URL. Verified on a real page — `window.nostr` is
present with `getPublicKey`, `signEvent`, `nip04` and `nip44`.

The key is omitted on Firefox. It is Chrome-only, and Firefox already assigns
each installation a random UUID for its `moz-extension://` origin, so the
resource URL is not stable across installs there regardless.

**The `matches` list is asserted here and decided elsewhere.** It must stay
identical to `matches` in `src/extension/content.ts`, and it appears as a literal
in three places: `PROVIDER_MATCHES` in `wxt.config.ts`, `PROVIDER_MATCHES` in the
assertion test, and `defineContentScript` in `content.ts`.
`harden-provider-trust-boundary` owns whether the provider should be offered to
plaintext `http://` origins. If it narrows the list, all three literals change
together — which is the point: the injection surface cannot move without a
deliberate edit to an assertion.

## Verifying a build

```bash
pnpm run test:manifest   # builds both targets, then runs the assertion suite
```

The suite reads `.output/<target>/manifest.json` and asserts, per target: every
CSP directive and its reviewed sources; that nothing forbidden appears in
`script-src`; that no plaintext scheme appears in `connect-src` or `img-src`;
the permission set; the web-accessible resource entry; the content-script
`matches` and `run_at`; the manifest version; that the background context is not
persistent; and a recursive walk over every string value in the manifest that
fails on scaffold placeholders (`true|false`, `Default Side Panel Title`,
`/icon-16.png`, an ellipsis, an unsubstituted `{{template}}`).

It **skips with a message naming the build command** when a target has not been
built, so `pnpm test` on a fresh clone is not confusing. That also means a CI job
that runs the tests without building first will skip these assertions — see the
note in `docs/ci-verification.md`.

### Page smoke

The manifest assertions cannot see a CSP directive that is present but too
tight. Chromium exposes that through `securitypolicyviolation`, so the
verification for a CSP change is:

1. Load `.output/chrome-mv3` unpacked.
2. Open `popup.html`, `options.html`, `sidepanel.html` and `approval.html`.
3. Confirm a Radix dialog opens with scroll locked (`style-src
   'unsafe-inline'`), the bundled fonts load (`font-src 'self'`), the Profile page's Refresh picture loads your own picture (`img-src https:`) and the header then shows the stored copy, key import and
   key creation submit (`form-action 'none'`), and profile image upload reaches
   nostr.build (`connect-src https://nostr.build`).
4. Confirm no `securitypolicyviolation` fires beyond the known `eval` pair
   described above.

The Playwright suite (`pnpm run test:e2e`) loads the built extension unpacked and
drives all four of those pages plus provider injection, so it exercises the real
CSP on every run. It is the cheapest regression signal for a CSP that is too
tight, even though it does not assert on violations directly.

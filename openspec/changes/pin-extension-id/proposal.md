## Why

Chrome derives an extension's identifier from its public key. The Chrome Web Store holds Ostrilo's key and gives the published build the identifier `nhodljdjlljpapclgcjmhajpgodanchk`. A build loaded unpacked has no key, so Chrome derives its identifier from the folder path instead: every checkout, and every contributor, gets a different `chrome-extension://` origin.

That has not mattered so far, because nothing outside the extension was bound to the origin. `add-biometric-unlock` changes this. A passkey is scoped to the origin that created it, so a passkey enrolled in one build cannot be used from a build with another identifier, and what is tested unpacked would not be what ships. That change names this one as a prerequisite: no enrolment path may ship before the identifier is pinned.

## What Changes

- The Chromium manifest declares `key`, set to the public key read off the Chrome Web Store listing's Package tab. Every Chromium build — `pnpm run build`, the development build and the store archive — then resolves to the published identifier.
- The Firefox manifest does not declare it. Firefox takes its identifier from `browser_specific_settings` and treats `key` as an unknown manifest key.
- `tests/security/manifest-assertions.test.ts` derives the identifier from the built Chromium manifest's key and fails if it is not the published one, and fails if the Firefox manifest carries a key.

The key is public and is not a signing key; the store keeps the private half.

## Impact

- **Unpacked and development installs change identifier once.** Chrome treats the pinned build as a different extension from the path-derived one, so a vault held in an existing unpacked install does not carry over. Export the keys from the old install first. Installs from the Chrome Web Store are unaffected: they already have this identifier.
- **An unpacked build and the store build can no longer be installed side by side** in one browser profile, because they now share an identifier.
- **The store accepts a `key` on an update when it matches the item's own key.** Community reports say a first upload of a new item is refused with a key present; Ostrilo is already published, so this applies only if the item were ever re-created.
- Affected spec: `extension-manifest-policy`. Affected code: `wxt.config.ts`, `tests/security/manifest-assertions.test.ts`.

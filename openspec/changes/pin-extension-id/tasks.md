## 1. Pin The Identifier

- [x] 1.1 Read the public key off the Chrome Web Store listing's Package tab and confirm it resolves to `nhodljdjlljpapclgcjmhajpgodanchk`.
- [x] 1.2 Declare it as manifest `key` in `wxt.config.ts`'s manifest factory, omitted for Firefox.
- [x] 1.3 Assert per target in `tests/security/manifest-assertions.test.ts`: the Chromium manifest's key resolves to the published identifier; the Firefox manifest declares none.
- [x] 1.4 Confirm the identifier shown in `chrome://extensions` is the published one for an unpacked `pnpm run build` and for the development build.
- [ ] 1.5 Confirm the published identifier in the Chrome Web Store listing URL is `nhodljdjlljpapclgcjmhajpgodanchk`.

## 2. Ship

- [x] 2.1 `pnpm run compile`, `pnpm run test:coverage`, `pnpm run build`, `pnpm run build:firefox`.
- [ ] 2.2 Publish a release carrying the key, and confirm the store accepts the archive.

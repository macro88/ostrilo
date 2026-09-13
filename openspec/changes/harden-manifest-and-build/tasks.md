## 1. Fix The Broken Firefox Manifest Output

- [ ] 1.1 Replace the placeholder `<title>Default Side Panel Title</title>` in `src/extension/sidepanel/index.html` with a real title.
- [ ] 1.2 Delete the scaffold `<meta name="manifest.default_icon">`, `<meta name="manifest.open_at_install">`, and `<meta name="manifest.browser_style">` tags and the commented `manifest.include`/`manifest.exclude` lines from the same file.
- [ ] 1.3 Rebuild the Firefox target and confirm `sidebar_action` reduces to a valid `default_panel` plus `default_title` with no `true|false`, no `/icon-16.png`, and no ellipsis strings.
- [ ] 1.4 Confirm the side panel still renders and still picks up the extension `icons` block.

## 2. Declare The Content Security Policy

- [ ] 2.1 Add `content_security_policy.extension_pages` to the `manifest` block in `wxt.config.ts` with the directives from design Decision 1.
- [ ] 2.2 Build both targets and read both generated manifests to confirm the MV3 object form and, if the Firefox target is still MV2 at this point, the flattened MV2 string.
- [ ] 2.3 Confirm `connect-src` includes `'self'` so the bundled `.glb` still loads, includes a `wss:` source for relays, and includes `https://nostr.build` for profile image upload.
- [ ] 2.4 Confirm `img-src` allows `'self'`, `data:`, and `https:` but not `http:`.
- [ ] 2.5 Confirm `style-src` includes `'unsafe-inline'` so Radix runtime style injection keeps working, and that `script-src` does not.
- [ ] 2.6 Verify no `eval`, `new Function`, or WebAssembly use has been introduced that would need `script-src` relaxed.

## 3. Least-Privilege Permissions And Resource Exposure

- [ ] 3.1 Remove the explicit `"sidePanel"` entry from `permissions` in `wxt.config.ts`.
- [ ] 3.2 Confirm the Chrome manifest still contains `sidePanel` because WXT adds it for MV3 sidepanel entrypoints, and that the docked side panel still opens.
- [ ] 3.3 Confirm the Firefox manifest no longer requests the invalid `sidePanel` permission.
- [ ] 3.4 Confirm `storage` and `windows` remain in both manifests and that no `host_permissions` key appears.
- [ ] 3.5 Add `use_dynamic_url: true` to the `injected.js` `web_accessible_resources` entry.
- [ ] 3.6 Align the `web_accessible_resources` `matches` list with the content-script `matches` list owned by `harden-provider-trust-boundary`.
- [ ] 3.7 Load a real page and confirm `window.nostr` is still injected under the dynamic resource URL.

## 4. Strip Console Output From Production Builds

- [ ] 4.1 Add an esbuild `drop` setting for `console` and `debugger` to the `vite` factory in `wxt.config.ts`, applied to production builds only.
- [ ] 4.2 Confirm no `console` call remains in `.output/chrome-mv3/background.js` or any other production output file.
- [ ] 4.3 Confirm a development build still retains console output.
- [ ] 4.4 Confirm `remove-key-exfiltration-surface` does not also add a build-level console-drop setting, per the ownership split in design Decision 4.

## 5. Firefox Manifest Version

- [ ] 5.1 Set `manifestVersion: 3` for the Firefox target in `wxt.config.ts`.
- [ ] 5.2 Confirm the generated Firefox manifest declares a non-persistent background context and no persistent background page.
- [ ] 5.3 Update every hardcoded `.output/firefox-mv2` reference in docs, test fixtures, and CI to the new output path.
- [ ] 5.4 Review module-scope state in `src/extension/background.ts`, including `approvalWindowId` and `approvalWindowOperation`, for assumptions that the background context survives suspension.
- [ ] 5.5 If MV3 migration is blocked, fall back to MV2 with `background.persistent: false` and record the blocker in the change.

## 6. Build Output And Archive Hygiene

- [ ] 6.1 Add `zip.exclude` to `wxt.config.ts` covering `**/*.map` and the unreferenced root `icon.png`/`icon.svg`.
- [ ] 6.2 Determine whether `@wxt-dev/auto-icons` needs `public/icon.png` and `public/icon.svg`, and move them out of `public/` if it does not.
- [ ] 6.3 Add explicit `zip.excludeSources` entries for `test-results/**`, `playwright-report/**`, `coverage/**`, `docs/**`, `openspec/**`, `stats.html`, `stats-*.json`, `**/*.bak`, `logs/**`, and `**/*.log`.
- [ ] 6.4 Decide between an `includeSources` allowlist and the expanded `excludeSources` list, per design Decision 8, and configure the chosen one.
- [ ] 6.5 Confirm production builds still emit no `.map` files and no `sourceMappingURL` comments.
- [ ] 6.6 Produce both archives, list their contents, and confirm no `test-results/` file and no browser profile data is present.
- [ ] 6.7 Extract the sources archive into a clean directory and confirm `pnpm install` followed by the Firefox build succeeds from its contents alone.

## 7. Manifest Assertion Test

- [ ] 7.1 Add `tests/security/manifest-assertions.test.ts` that reads the generated manifest for each build target as JSON.
- [ ] 7.2 Assert the content security policy contains every required directive and none of the forbidden sources, for each target.
- [ ] 7.3 Assert `permissions` equals the reviewed allowlist per target, with `sidePanel` present on Chrome and absent on Firefox, and leave a place for the `alarms` permission that `implement-session-auto-lock` adds.
- [ ] 7.4 Assert the `injected.js` web-accessible resource entry has the expected `matches` and, on Chrome, `use_dynamic_url: true`.
- [ ] 7.5 Assert the provider content script declares the expected `matches` literal and `run_at: "document_start"`.
- [ ] 7.6 Assert the background declaration is a service worker or a non-persistent page for every target.
- [ ] 7.7 Add a recursive walk over every string value in the parsed manifest that fails on placeholder strings including `true|false`, `Default Side Panel Title`, `/icon-16.png`, and an ellipsis.
- [ ] 7.8 Assert no production output file contains a `console` call, a `.map` file, or a `sourceMappingURL` comment.
- [ ] 7.9 Skip the suite with an explicit message naming the required build commands when the output directory is absent.

## 8. Verifiable Builds

- [ ] 8.1 Pin the Node version with an `.nvmrc` or an `engines` field alongside the existing `packageManager` pin.
- [ ] 8.2 Document the exact commands, package manager version, and Node version that produce a published artifact.
- [ ] 8.3 Document how to obtain a digest of each release artifact and which files a user can compare.
- [ ] 8.4 Record store re-signing and unverified bundler determinism as known gaps with the reason each is deferred.

## 9. Documentation

- [ ] 9.1 Correct the "Minimal manifest permissions: only `storage` and `sidePanel`" claim in `openspec/project.md`.
- [ ] 9.2 Correct the "Firefox Manifest V2" statements in `openspec/project.md` to match the shipped manifest version.
- [ ] 9.3 Add the declared content security policy to the security constraints section of `openspec/project.md`, replacing the vaguer "No remote code execution - CSP prevents eval, no remote scripts" note.

## 10. Verification

- [ ] 10.1 Run `openspec validate harden-manifest-and-build --strict`.
- [ ] 10.2 Run `pnpm run compile`.
- [ ] 10.3 Run `pnpm run build` and `pnpm run build:firefox`.
- [ ] 10.4 Inspect both generated `manifest.json` files by hand and confirm the CSP, permissions, `web_accessible_resources`, content-script matches, background shape, and absence of placeholders.
- [ ] 10.5 Run the new manifest assertion suite and confirm it fails when the CSP is temporarily removed from `wxt.config.ts`.
- [ ] 10.6 Run `pnpm test` and confirm no existing unit, integration, or security test regressed.
- [ ] 10.7 Manually smoke the popup, options, side panel, and approval window with the browser console open, exercising the 3D logo, a relay-supplied avatar image, a Radix dialog, key import and key creation forms, profile image upload, and activity log export, and confirm no CSP violation appears.
- [ ] 10.8 Run `pnpm run test:e2e` and confirm the NIP-07 provider still injects under the dynamic resource URL.
- [ ] 10.9 Run `pnpm zip` and `pnpm zip:firefox`, then list the contents of every produced archive and confirm they match the shipped-file allowlist.
- [ ] 10.10 Defer `npx react-doctor@latest`; it currently fails to install because pnpm rejects it with `ERR_PNPM_TRUST_DOWNGRADE` on `semver@6.3.1`. Run it once `restore-security-test-assurance` has pinned React Doctor locally.

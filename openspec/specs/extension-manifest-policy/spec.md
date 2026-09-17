# Extension Manifest Policy Specification

## Purpose

Define the security-relevant declarations every generated browser extension manifest must carry, across all build targets. Covers the content security policy, permission set, background context, web-accessible resources, content-script host matches, and the automated test that asserts them.

## Requirements

### Requirement: Every Generated Manifest Declares A Content Security Policy

Every generated manifest SHALL declare an explicit content security policy for extension pages. The extension MUST NOT rely on a browser default to restrict script execution, network destinations, or media sources.

#### Scenario: Chrome MV3 manifest declares extension pages policy

- **WHEN** the Chrome build is generated
- **THEN** `manifest.json` contains a `content_security_policy` key
- **AND** `content_security_policy.extension_pages` is a non-empty string

#### Scenario: Firefox manifest declares the same policy in the form its manifest version requires

- **WHEN** the Firefox build is generated
- **THEN** the manifest declares a content security policy for extension pages
- **AND** the declared directives match the Chrome policy except where the target manifest version rejects a source expression

#### Scenario: Script execution is restricted to bundled code

- **WHEN** either generated manifest is read
- **THEN** the extension pages policy contains `script-src 'self'`
- **AND** the policy does not contain `'unsafe-eval'`
- **AND** the policy does not contain `'unsafe-inline'` in `script-src`
- **AND** the policy does not contain a remote http or https origin in `script-src`

#### Scenario: Plugin content is restricted

- **WHEN** either generated manifest is read
- **THEN** the extension pages policy contains `object-src 'self'`

#### Scenario: Network destinations are restricted to relays and the declared upload host

- **WHEN** either generated manifest is read
- **THEN** the extension pages policy declares a `connect-src` directive
- **AND** `connect-src` includes `'self'` so bundled assets such as the 3D model file can be fetched
- **AND** `connect-src` includes a secure WebSocket source so user-configured relays remain reachable
- **AND** `connect-src` includes `https://nostr.build` so profile image upload continues to work
- **AND** `connect-src` does not include a plaintext `ws:` or `http:` source

#### Scenario: Remote media is restricted to secure origins

- **WHEN** either generated manifest is read
- **THEN** the extension pages policy declares an `img-src` directive
- **AND** `img-src` includes `'self'` and `https:`
- **AND** `img-src` does not include `http:`

#### Scenario: Fallback directive is declared

- **WHEN** either generated manifest is read
- **THEN** the extension pages policy declares a `default-src` directive
- **AND** `default-src` does not include a wildcard `*` source

### Requirement: Generated Manifests Contain No Placeholder Or Scaffold Values

Generated manifests SHALL contain only real values. No manifest key may carry a build-tool template placeholder, a scaffold default title, or a value whose type does not match what the target browser expects.

#### Scenario: Firefox side panel declaration carries no placeholders

- **WHEN** the Firefox build is generated
- **THEN** no manifest value equals the string `true|false`
- **AND** no manifest value contains the substring `'/icon-16.png'`
- **AND** no manifest value contains an ellipsis placeholder
- **AND** no manifest value equals the string `Default Side Panel Title`

#### Scenario: Boolean manifest fields are booleans

- **WHEN** either generated manifest is read
- **THEN** every manifest field whose specification defines a boolean type has a JSON boolean value, not a string

#### Scenario: Side panel title identifies the extension

- **WHEN** the Firefox build is generated
- **THEN** the side panel default title names Ostrilo

### Requirement: No Build Target Uses A Persistent Background Context

No generated manifest SHALL declare a persistent background page. Decrypted key material held in background memory MUST be bounded by background context suspension on every supported browser, not only on Chrome.

#### Scenario: Chrome background is a service worker

- **WHEN** the Chrome build is generated
- **THEN** `background.service_worker` is declared
- **AND** no `background.persistent` value of `true` is present

#### Scenario: Firefox background is not persistent

- **WHEN** the Firefox build is generated
- **THEN** the manifest does not declare a background context that stays resident for the whole browser session
- **AND** if the manifest version is 2, `background.persistent` is `false`

#### Scenario: Firefox target manifest version is recorded

- **WHEN** the Firefox build is generated
- **THEN** the manifest `manifest_version` value matches the version the build configuration declares for the Firefox target

### Requirement: Manifests Request Only Permissions The Extension Uses

Every generated manifest SHALL request only permissions the extension calls at runtime, and SHALL NOT request a permission that is invalid for the target browser.

#### Scenario: Storage permission is present

- **WHEN** either generated manifest is read
- **THEN** `permissions` includes `storage`

#### Scenario: Windows permission is present because the approval window needs it

- **WHEN** either generated manifest is read
- **THEN** `permissions` includes `windows`

#### Scenario: Chrome requests the side panel permission because the side panel API is called

- **WHEN** the Chrome build is generated
- **THEN** `permissions` includes `sidePanel`
- **AND** a `side_panel` manifest entry is declared

#### Scenario: Firefox does not request the Chrome-only side panel permission

- **WHEN** the Firefox build is generated
- **THEN** `permissions` does not include `sidePanel`

#### Scenario: No unreviewed permission appears

- **WHEN** either generated manifest is read
- **THEN** every entry in `permissions` appears in the reviewed permission allowlist recorded by the manifest assertion test
- **AND** the manifest declares no `host_permissions` entry that is not required by a declared content script

### Requirement: The Web Accessible Injected Script Is Not A Stable Fingerprint

The injected NIP-07 provider script SHALL be exposed through a URL that pages cannot predict, so an arbitrary page cannot probe for a fixed extension resource URL to detect that the user runs a Nostr signer.

#### Scenario: Dynamic URL is declared

- **WHEN** the Chrome build is generated
- **THEN** the `web_accessible_resources` entry listing `injected.js` sets `use_dynamic_url` to `true`

#### Scenario: The resource is still exposed only to web page origins

- **WHEN** the Chrome build is generated
- **THEN** the `web_accessible_resources` entry listing `injected.js` declares a `matches` array
- **AND** every entry in that array is a scheme-qualified page match pattern
- **AND** the array contains no `<all_urls>` entry

#### Scenario: Injection still resolves the resource at runtime

- **WHEN** the content script injects the provider script on a page
- **THEN** the script loads successfully
- **AND** `window.nostr` becomes available on that page

### Requirement: Content Script Host Matches Are Asserted Against The Manifest

The content-script host match list SHALL be asserted against the generated manifest so that a change to the injection surface cannot ship without updating the assertion.

#### Scenario: Manifest content script matches the asserted list

- **WHEN** either generated manifest is read
- **THEN** the `content_scripts` entry for the provider bridge declares exactly the match patterns recorded in the manifest assertion test
- **AND** `run_at` is `document_start`

#### Scenario: Adding a scheme to the injection surface fails the assertion

- **WHEN** a build adds a host match pattern to the provider content script that the manifest assertion test does not record
- **THEN** the manifest assertion test fails

### Requirement: Generated Manifests Are Verified By An Automated Test

The test suite SHALL include a test that reads the generated manifest for every build target and asserts its security-relevant declarations, so that a manifest regression fails the build rather than reaching a store submission.

#### Scenario: Test asserts on real build output

- **WHEN** the manifest assertion test runs after a production build
- **THEN** it reads the generated `manifest.json` for the Chrome target and for the Firefox target
- **AND** it asserts the content security policy, the permission set, the web-accessible resource declaration, and the content-script matches

#### Scenario: Test fails when a required declaration is removed

- **WHEN** the content security policy is removed from the build configuration
- **THEN** the manifest assertion test fails for both targets

#### Scenario: Test fails when a placeholder value appears

- **WHEN** any generated manifest value contains a build-tool template placeholder
- **THEN** the manifest assertion test fails and names the offending key

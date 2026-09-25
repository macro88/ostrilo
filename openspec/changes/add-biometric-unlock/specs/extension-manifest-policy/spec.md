## MODIFIED Requirements

### Requirement: Manifests Request Only Permissions The Extension Uses

Every generated manifest SHALL request only permissions the extension calls at runtime, and SHALL NOT request a permission that is invalid for the target browser. The reviewed permission set SHALL remain exactly `storage`, `windows` and `alarms`, plus `sidePanel`, which the build tool adds on Chromium for the side panel entrypoint. No generated manifest SHALL declare a host permission, including a host permission claiming a WebAuthn relying-party identifier. Adding a capability SHALL NOT widen this set.

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

#### Scenario: The reviewed allowlist admits exactly four names

- **WHEN** the reviewed permission allowlist recorded by the manifest assertion test is read
- **THEN** it contains exactly `storage`, `windows`, `alarms` and `sidePanel`
- **AND** the declared permission set the build configuration writes is exactly `storage`, `windows` and `alarms`

#### Scenario: Biometric unlock adds no permission

- **GIVEN** a Chromium build with biometric unlock compiled in
- **WHEN** its `permissions` array is compared with the build that precedes biometric unlock
- **THEN** the two sets are identical
- **AND** the ceremony window is opened under the `windows` permission already held

#### Scenario: No host permission is declared for a relying-party identifier

- **WHEN** either generated manifest is read
- **THEN** it declares no `host_permissions` key
- **AND** no host permission is declared in order to claim a WebAuthn relying-party identifier
- **AND** a build that introduces one fails the manifest assertion test as a security regression

#### Scenario: The cross-browser relying-party route is refused rather than permitted

- **GIVEN** a proposal to assert an owned HTTPS domain as the relying-party identifier
- **WHEN** it is weighed against this requirement
- **THEN** it is refused because it requires a host permission
- **AND** the relying-party identifier remains the extension origin, which needs none

### Requirement: Every Generated Manifest Declares A Content Security Policy

Every generated manifest SHALL declare an explicit content security policy for extension pages. The extension MUST NOT rely on a browser default to restrict script execution, network destinations, or media sources. Every extension document the build emits — the popup, the options page, the side panel, the approval window and the biometric ceremony page — SHALL be governed by that single extension-pages policy, and no document SHALL require a source expression the policy does not already declare.

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
- **AND** `connect-src` does not include `'self'`: nothing in an extension page fetches a bundled file, so the extension origin is not a network destination
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

#### Scenario: The biometric ceremony page is governed by the same policy

- **WHEN** the Chromium build is generated
- **THEN** the ceremony document is an extension page served from the extension origin
- **AND** no per-document content security policy is declared for it
- **AND** it loads only bundled script under `script-src 'self'`

#### Scenario: The ceremony page adds no content security policy source

- **GIVEN** a Chromium build with biometric unlock compiled in
- **WHEN** its extension pages policy is compared with the build that precedes biometric unlock
- **THEN** the two policies are identical
- **AND** no directive gains a source expression

#### Scenario: The ceremony page is not web accessible

- **WHEN** either generated manifest is read
- **THEN** no `web_accessible_resources` entry lists the ceremony document
- **AND** no page origin can navigate to it

#### Scenario: The ceremony page is present in the Chromium build only

- **WHEN** the Chrome build is generated
- **THEN** the ceremony document is emitted as an extension page
- **AND** the Firefox build emits no ceremony document and no manifest entry referencing one

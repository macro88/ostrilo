## MODIFIED Requirements

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

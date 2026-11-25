## ADDED Requirements

### Requirement: Chromium Builds Resolve To The Published Extension Identifier

Every Chromium manifest the build produces SHALL declare a `key` whose derived extension identifier is the identifier the Chrome Web Store assigned to Ostrilo, so that an unpacked build, a development build and the published build share one `chrome-extension://` origin. The Firefox manifest MUST NOT declare `key`.

#### Scenario: A Chromium build carries the published identifier

- **WHEN** the Chromium manifest is generated
- **THEN** it declares a `key`
- **AND** the identifier derived from that key is `nhodljdjlljpapclgcjmhajpgodanchk`

#### Scenario: A changed key fails the build's verification

- **GIVEN** a Chromium manifest whose `key` derives any other identifier, or which declares no `key`
- **WHEN** the manifest assertions run
- **THEN** they fail, naming that enrolled passkeys and stored data are bound to the published identifier

#### Scenario: The Firefox manifest declares no key

- **WHEN** the Firefox manifest is generated
- **THEN** it declares no `key`

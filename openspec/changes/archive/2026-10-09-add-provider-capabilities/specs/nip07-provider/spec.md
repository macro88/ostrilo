## ADDED Requirements

### Requirement: Capabilities Object For Feature Detection

The extension SHALL expose `window.nostr.capabilities`, a read-only object of the form `{ methods: string[] }`, so a dApp can detect which provider methods Ostrilo implements without calling one. `methods` SHALL list exactly the methods the provider implements, and SHALL be derived from the same list the provider and the content script's request allowlist are built from, so what the extension advertises cannot drift from what the provider implements. The object SHALL carry no extension version, build identifier or other value beyond the method names.

#### Scenario: Capabilities list the implemented methods
- **WHEN** a dApp reads `window.nostr.capabilities.methods`
- **THEN** it SHALL equal the names of the functions `window.nostr` implements, which are `getPublicKey` and `signEvent`
- **AND** it SHALL NOT contain `nip04` or `nip44`

#### Scenario: One list feeds the provider and what it advertises
- **GIVEN** a method is added to or removed from the provider's method list
- **WHEN** the extension is built
- **THEN** the provider's methods, `capabilities.methods` and the content script's allowlist SHALL all reflect the change
- **AND** a provider implementation that does not match the list SHALL fail to compile
- **AND** a method with no relay case and RPC wiring SHALL be refused with `unknown_method`

#### Scenario: Capabilities carry nothing that identifies the setup
- **WHEN** a dApp enumerates `window.nostr.capabilities`
- **THEN** its only own property SHALL be `methods`
- **AND** `methods` SHALL hold only method-name strings
- **AND** no extension version, build identifier or feature flag SHALL be present

#### Scenario: An existing provider is left alone, capabilities included
- **GIVEN** another signer has already defined `window.nostr`
- **WHEN** the Ostrilo injected script runs
- **THEN** Ostrilo SHALL NOT add `capabilities` to the existing object
- **AND** a dApp SHALL treat an absent `capabilities` as "not reported", not as "no methods"

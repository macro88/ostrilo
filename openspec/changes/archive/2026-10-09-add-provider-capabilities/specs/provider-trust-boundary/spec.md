## ADDED Requirements

### Requirement: Capabilities Object Is Tamper-Resistant

`window.nostr.capabilities` and its `methods` array SHALL be frozen, so a page script cannot change what the provider advertises to other scripts on the page. Adding the object SHALL NOT weaken any protection of the provider property or its methods.

#### Scenario: Capabilities cannot be replaced
- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns, redefines or deletes `window.nostr.capabilities`
- **THEN** the operation SHALL NOT take effect
- **AND** `window.nostr.capabilities` SHALL still list the implemented methods

#### Scenario: The methods list cannot be altered
- **GIVEN** `window.nostr` has been defined by Ostrilo
- **WHEN** a page script assigns to, pushes onto, truncates or redefines `window.nostr.capabilities.methods`
- **THEN** the operation SHALL NOT take effect
- **AND** `window.nostr.capabilities.methods` SHALL be unchanged

#### Scenario: Existing protections still hold
- **GIVEN** `window.nostr` has been defined by Ostrilo with `capabilities`
- **THEN** `window.nostr` SHALL still be non-writable and non-configurable
- **AND** the provider object and its methods SHALL still be frozen

## ADDED Requirements

### Requirement: Re-Unlock Zeroizes The Key Material It Replaces

When `unlock()` runs while decrypted keys are already held in background memory, the vault SHALL zeroize every held key buffer before discarding it, so a re-unlock leaves no previous key material readable.

#### Scenario: Re-unlock while unlocked

- **GIVEN** the vault is unlocked and a test holds a reference to a decrypted key buffer from that unlock
- **WHEN** `unlock()` is called again with the correct password
- **THEN** every byte of the retained buffer reads zero
- **AND** the vault is unlocked with freshly decrypted key material

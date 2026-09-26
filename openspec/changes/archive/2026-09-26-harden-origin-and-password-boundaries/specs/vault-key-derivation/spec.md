## ADDED Requirements

### Requirement: Stored KDF Parameters Are Bounded Above

The vault SHALL refuse, before any key derivation, a stored record or envelope whose recorded KDF parameters exceed the ceilings defined beside `KDF_FLOORS`, in the same way it refuses parameters below the floor. The shipped defaults SHALL lie within the floors and ceilings.

#### Scenario: A tampered memory cost is refused without deriving

- **GIVEN** a stored envelope whose Argon2id memory cost exceeds the ceiling
- **WHEN** the user attempts to unlock
- **THEN** unlock fails with a KDF-parameter error
- **AND** no Argon2id derivation is started

#### Scenario: Defaults sit inside the bounds

- **WHEN** the security suite compares `KDF_DEFAULTS` with the floors and ceilings
- **THEN** every default parameter is at or above its floor and at or below its ceiling

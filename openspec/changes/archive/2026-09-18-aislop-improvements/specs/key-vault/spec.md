## ADDED Requirements

### Requirement: Secret Cleanup Begins At Acquisition

Cleanup responsibility for a sensitive buffer SHALL begin at the moment the buffer is
successfully acquired, not at the moment the operation's main body is entered. Once an
operation holds a password-derived key-encryption key, a private key, a
data-encryption key, or any other secret buffer, every subsequent code path in that
operation — including a failure raised before the operation's main work starts — SHALL
zeroize that buffer before control returns to the caller.

An operation that acquires a secret and then performs fallible work outside its
cleanup block does not satisfy the Memory Zeroization requirement, even when its
success path and its main body both zeroize correctly.

Cleanup SHALL NOT alter the error the caller observes. The original error SHALL
propagate unchanged, with its message intact, so that cleanup can never mask or
replace a failure.

Where an operation transfers ownership of a secret to a longer-lived holder — the
unlocked-key set, or a caller documented as owning the returned buffer — it SHALL
zeroize that buffer on every failure path and SHALL NOT zeroize it on the success path
that performs the transfer.

#### Scenario: Malformed private key input still clears the derived key

- **GIVEN** a vault whose password successfully derives a key-encryption key
- **WHEN** `importKey` is called with a private-key string that the parser rejects
- **THEN** the call MUST reject with the parser's own error
- **AND** every byte of the derived key-encryption key MUST read zero
- **AND** no key record MUST be written to storage

#### Scenario: Random number generator failure still clears the derived key

- **GIVEN** a vault whose password successfully derives a key-encryption key
- **WHEN** `generateKey` is called and the platform random number generator throws while drawing the private key
- **THEN** the call MUST reject with that error
- **AND** every byte of the derived key-encryption key MUST read zero
- **AND** no key record MUST be written to storage

#### Scenario: Envelope persistence failure still clears the derived key

- **GIVEN** a vault with no envelope, so a write creates one
- **WHEN** the new envelope is created successfully but persisting it to storage fails
- **THEN** the call MUST reject
- **AND** every byte of the key-encryption key derived for that envelope MUST read zero

#### Scenario: Successful acquisition hands ownership to the caller

- **GIVEN** an internal helper documented as returning a live key-encryption key that the caller MUST zeroize
- **WHEN** the helper returns successfully
- **THEN** the returned buffer MUST still hold its derived bytes
- **AND** the calling operation MUST zeroize it before returning to its own caller, on both its success and its failure paths

#### Scenario: Existing success behavior is unchanged

- **WHEN** `generateKey` or `importKey` is called with a valid password and valid input
- **THEN** the key record MUST be created exactly as before this requirement was added
- **AND** the first key in an empty vault MUST still be marked selected
- **AND** the private key and the key-encryption key MUST both read zero after the call resolves

#### Scenario: Cleanup does not replace the original error

- **GIVEN** an operation that fails after acquiring a secret buffer
- **WHEN** the operation's cleanup runs
- **THEN** the error observed by the caller MUST be the error originally raised
- **AND** cleanup MUST NOT substitute a different error, swallow the failure, or return a value

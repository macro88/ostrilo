## ADDED Requirements

### Requirement: Lock Teardown Does Not Depend On Settings Storage

`lock()` SHALL zeroize key material, write the locked state and remove session grants before any settings write, and SHALL run every lock listener even when the settings write or its change broadcast fails. A settings failure SHALL still be reported to the caller after the listeners have run.

#### Scenario: Sync storage refuses the write during lock

- **GIVEN** the vault is unlocked with an approval request pending
- **AND** writing settings to sync storage throws
- **WHEN** the vault locks
- **THEN** the pending request is resolved as denied
- **AND** the approval badge is cleared
- **AND** the lock state reports locked
- **AND** the settings failure is surfaced to the caller rather than discarded

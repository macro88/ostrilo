## ADDED Requirements

### Requirement: The Inactivity Deadline Is Exactly The Configured Timeout

The extension SHALL compute the inactivity deadline as the recorded last-activity time plus exactly `autoLockMinutes` minutes, with `35` minutes equal to `2,100,000` ms. The vault SHALL report unlocked at every instant before the deadline and locked at the deadline. A change to `autoLockMinutes` SHALL apply to a session already running, and every unlock SHALL begin a new deadline that no earlier deadline can shorten.

#### Scenario: A 35 minute timeout locks at 35 minutes

- **GIVEN** the vault was unlocked at time `T` with `autoLockMinutes` of `35` and no activity since
- **WHEN** lock state is read at `T` plus 34 minutes 59 seconds
- **THEN** the vault reports unlocked
- **AND** the reported deadline is `T` plus `2,100,000` ms
- **WHEN** lock state is read at `T` plus 35 minutes
- **THEN** the vault reports locked

#### Scenario: A shortened timeout applies to the running session

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `35` and the last activity was ten minutes ago
- **WHEN** `autoLockMinutes` is changed to `5`
- **THEN** the vault reports locked

#### Scenario: A new unlock replaces the old deadline

- **GIVEN** the vault was unlocked, locked, and unlocked again
- **WHEN** lock state is read
- **THEN** the deadline is measured from the second unlock

#### Scenario: A recorded activity time that is not a finite number fails closed

- **GIVEN** stored session lock state records an unlocked vault
- **AND** its last-activity value is `NaN`, a string, zero, negative or absent
- **WHEN** lock state is queried
- **THEN** the vault reports locked

### Requirement: The Background Is Kept Alive While The Vault Is Unlocked

The extension SHALL keep the background alive while, and only while, the vault is unlocked, so that the configured inactivity timeout is honoured while no extension page is open. From a successful unlock on any surface, the background SHALL call a cheap extension API that resets the browser's idle timer about every 20 seconds, and SHALL stop doing so on every lock path: manual lock, inactivity lock, and a lock recorded because the state was unreadable or the clock moved backwards.

The keepalive SHALL NOT run past the inactivity deadline. Each cycle SHALL read lock state through the vault before it calls the extension API, and SHALL stop without calling it when the vault is locked, when lock state cannot be read, or when the reported deadline is absent, not finite, or further away than the longest permitted auto-lock timeout.

The keepalive SHALL hold no decrypted key, password or derived key material, SHALL write to no storage, and SHALL NOT count as activity. It MUST NOT be the mechanism that enforces the lock: the lock continues to derive from the stored last-activity timestamp on every access. Decrypted key material SHALL remain in background memory only and SHALL NOT be persisted in order to survive the background being ended.

#### Scenario: The background keeps running with no extension page open

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `35`
- **AND** every extension page is closed
- **WHEN** more than the browser's idle window passes
- **THEN** the background has called the extension API at about 20 second intervals
- **AND** the vault still reports unlocked

#### Scenario: Unlock from any surface starts it

- **WHEN** the vault is unlocked from the popup, the options page, the side panel, or the approval window
- **THEN** the keepalive starts

#### Scenario: Locking stops it

- **GIVEN** the keepalive is running
- **WHEN** the vault is locked manually
- **THEN** the keepalive stops
- **AND** no further keepalive call is made

#### Scenario: It does not outlive the deadline

- **GIVEN** the keepalive is running and the inactivity deadline is `T`
- **WHEN** time reaches `T`
- **THEN** the vault is locked
- **AND** the keepalive makes no call at or after `T`

#### Scenario: A deadline beyond the permitted maximum is refused

- **GIVEN** stored lock state reports a deadline further away than the longest permitted auto-lock timeout
- **WHEN** the keepalive next runs
- **THEN** it stops without calling the extension API

#### Scenario: Unreadable lock state stops it

- **GIVEN** the keepalive is running
- **WHEN** lock state cannot be read
- **THEN** the keepalive stops without calling the extension API

#### Scenario: Keepalive calls are not activity

- **GIVEN** the vault is unlocked and no user action is recorded
- **WHEN** the keepalive runs for the whole inactivity window
- **THEN** the vault locks at the deadline

#### Scenario: A background that is ended anyway fails closed

- **GIVEN** the vault is unlocked and the browser ends the background despite the keepalive
- **WHEN** the next request reaches a restarted background
- **THEN** the vault reports locked with the reason `background_restarted`
- **AND** no decrypted key material survived

#### Scenario: Firefox may unload the background earlier

- **GIVEN** the Firefox build, whose background is an event page
- **WHEN** the browser unloads the event page before the inactivity deadline
- **THEN** the vault fails closed as above
- **AND** the lock screen states that the browser restarted the background

### Requirement: Every Lock Records Why

The extension SHALL record, with the locked lock state in session storage, a non-secret reason from this set: `manual`, `inactivity`, `background_restarted`, `state_unreadable`, `clock_rollback`, `browser_restarted`, `extension_updated`. An `inactivity` lock SHALL also record the number of minutes of the timeout that elapsed. A browser session in which nothing has been unlocked yet SHALL report locked with no reason. The reason SHALL be cleared by the next unlock, SHALL contain no key material, and SHALL be the only addition `state.getLock` makes to a locked response beyond the selected key identifier.

#### Scenario: Each lock path records its reason

- **WHEN** the user locks manually
- **THEN** lock state reports locked with the reason `manual`
- **WHEN** the inactivity deadline passes
- **THEN** lock state reports locked with the reason `inactivity` and the elapsed minutes
- **WHEN** stored state says unlocked and the background holds no keys
- **THEN** lock state reports locked with the reason `background_restarted`
- **WHEN** stored state is malformed or cannot be read
- **THEN** lock state reports locked with the reason `state_unreadable`
- **WHEN** the last-activity timestamp is in the future
- **THEN** lock state reports locked with the reason `clock_rollback`

#### Scenario: Startup and update lock with their own reasons

- **WHEN** the browser starts and the extension locks the vault
- **THEN** the reason is `browser_restarted`
- **WHEN** the extension is installed or updated and locks the vault
- **THEN** the reason is `extension_updated`

#### Scenario: A reason is remembered for later readers

- **GIVEN** the vault locked at its inactivity deadline
- **WHEN** a surface opened afterwards reads lock state
- **THEN** it receives the same reason

#### Scenario: Unlocking clears the reason

- **GIVEN** the vault is locked with a recorded reason
- **WHEN** the user unlocks the vault
- **THEN** lock state reports unlocked with no reason

#### Scenario: An unrecognised stored reason is ignored

- **GIVEN** stored locked state carries a reason outside the permitted set
- **WHEN** lock state is queried
- **THEN** the vault reports locked with no reason

#### Scenario: A never-unlocked browser session reports no reason

- **GIVEN** session storage holds no lock state
- **WHEN** lock state is queried
- **THEN** the vault reports locked with no reason

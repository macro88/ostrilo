## MODIFIED Requirements

### Requirement: Privileged RPC Methods Require An Unlocked Vault

The extension SHALL refuse privileged RPC methods with the `locked` error code while the vault is locked, and SHALL enforce this in the background handlers rather than relying on UI gating. Privileged methods SHALL include `settings.update`, `policy.setOrigin`, `policy.setKindRule`, `policy.setSession`, `policy.clearSession`, `policy.removeOrigin`, `policy.evaluate`, `vault.select`, `vault.renameKey`, `vault.deleteKey`, `vault.sign`, `vault.export`, `vault.reveal`, `nostr.getPublicKey`, `nostr.signEvent`, `approval.resolve`, all `activity.*` methods, and all `profile.*` methods. Methods that SHALL remain reachable while locked are `vault.unlock`, `state.getLock`, `keys.list`, `crypto.evaluatePassword`, `crypto.parsePrivateKey`, and `settings.get`. While the vault is locked, `keys.list` SHALL return only the identifiers needed to determine that keys exist, `settings.get` SHALL return only the fields needed to render the lock screen and first-run flow, and `state.getLock` SHALL return only the locked state itself, without the inactivity deadline, plus the non-secret lock reason and, for an inactivity lock, the whole minutes of the timeout that elapsed, when the background recorded them.

#### Scenario: Settings mutation is refused while locked

- **GIVEN** the vault is locked
- **WHEN** `settings.update` is called with any patch
- **THEN** the call fails with the `locked` error code
- **AND** stored settings are unchanged

#### Scenario: Policy mutation is refused while locked

- **GIVEN** the vault is locked
- **WHEN** `policy.setOrigin` is called to raise an origin to `high` trust
- **THEN** the call fails with the `locked` error code
- **AND** the stored origin policy is unchanged

#### Scenario: Activity log is not readable while locked

- **GIVEN** the vault is locked
- **AND** the activity log holds entries with content previews
- **WHEN** `activity.getRecent` is called
- **THEN** the call fails with the `locked` error code
- **AND** no activity entry or content preview is returned

#### Scenario: Unlock path stays reachable while locked

- **GIVEN** the vault is locked
- **WHEN** `state.getLock`, `keys.list`, `crypto.evaluatePassword`, `settings.get`, and `vault.unlock` are called
- **THEN** each call is served
- **AND** the user can complete an unlock

#### Scenario: Locked reads are reduced to what the lock screen needs

- **GIVEN** the vault is locked
- **AND** origin policies, relays, and key labels are stored
- **WHEN** `settings.get` and `keys.list` are called
- **THEN** no origin policy, relay list entry, key label, or public key is returned
- **AND** the response still allows the UI to distinguish a first run from a locked vault with existing keys

#### Scenario: Locked lock state carries no deadline

- **GIVEN** the vault is locked
- **AND** a last-activity timestamp is present in stored session state
- **WHEN** `state.getLock` is called
- **THEN** no inactivity deadline is returned
- **AND** the response does not disclose when the previous session would have ended

#### Scenario: Locked lock state carries the lock reason and nothing else

- **GIVEN** the vault is locked with a recorded lock reason and a recorded last-activity timestamp
- **WHEN** `state.getLock` is called
- **THEN** the response contains the locked flag, the selected key identifier, the lock reason and, for an inactivity lock, the elapsed minutes
- **AND** it contains no other field

#### Scenario: A newly added privileged method is classified

- **WHEN** a new RPC method is added to the request union
- **THEN** the method is classified as privileged or reachable while locked
- **AND** an unclassified method is treated as privileged

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

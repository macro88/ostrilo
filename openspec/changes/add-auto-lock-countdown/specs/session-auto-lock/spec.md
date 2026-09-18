## ADDED Requirements

### Requirement: The Inactivity Deadline Is Disclosed Only To Trusted Extension Surfaces

The extension SHALL report the absolute inactivity deadline alongside lock state when the vault is unlocked, so that extension surfaces can display the time remaining without recomputing it. The reported deadline SHALL be derived from the same stored last-activity timestamp and the same normalized `autoLockMinutes` used to enforce the lock, from a single computation, so that the reported and enforced deadlines cannot diverge. The deadline SHALL NOT be reachable from a web page, and SHALL NOT be reported while the vault is locked.

#### Scenario: Deadline is reported to an extension surface while unlocked

- **GIVEN** the vault is unlocked
- **AND** `autoLockMinutes` is `15`
- **WHEN** an extension page calls `state.getLock`
- **THEN** the response reports the vault as unlocked
- **AND** the response carries an absolute deadline timestamp fifteen minutes after the last recorded activity

#### Scenario: Deadline is withheld while locked

- **GIVEN** the vault is locked
- **WHEN** an extension page calls `state.getLock`
- **THEN** the response reports the vault as locked
- **AND** no deadline timestamp is present in the response

#### Scenario: Deadline moves with recorded activity

- **GIVEN** the vault is unlocked
- **WHEN** the user performs an action that records activity
- **AND** an extension page calls `state.getLock`
- **THEN** the reported deadline is recomputed from the new last-activity timestamp

#### Scenario: Deadline moves with a timeout change

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `30`
- **WHEN** `autoLockMinutes` is changed to `5`
- **AND** an extension page calls `state.getLock`
- **THEN** the reported deadline is recomputed from the new timeout

#### Scenario: Reported deadline agrees with enforcement

- **GIVEN** the vault is unlocked
- **AND** `state.getLock` reported a deadline
- **WHEN** that deadline passes and any privileged operation is attempted
- **THEN** the vault reports locked
- **AND** the operation is refused with the `locked` error code

#### Scenario: A web page cannot read the deadline

- **GIVEN** the vault is unlocked
- **WHEN** a web page attempts to reach `state.getLock` through the content script
- **THEN** the call is refused
- **AND** no deadline timestamp is disclosed to the page

## MODIFIED Requirements

### Requirement: Privileged RPC Methods Require An Unlocked Vault

The extension SHALL refuse privileged RPC methods with the `locked` error code while the vault is locked, and SHALL enforce this in the background handlers rather than relying on UI gating. Privileged methods SHALL include `settings.update`, `policy.setOrigin`, `policy.setKindRule`, `policy.setSession`, `policy.clearSession`, `policy.removeOrigin`, `policy.evaluate`, `vault.select`, `vault.renameKey`, `vault.deleteKey`, `vault.sign`, `vault.export`, `vault.reveal`, `nostr.getPublicKey`, `nostr.signEvent`, `approval.resolve`, all `activity.*` methods, and all `profile.*` methods. Methods that SHALL remain reachable while locked are `vault.unlock`, `state.getLock`, `keys.list`, `crypto.evaluatePassword`, `crypto.parsePrivateKey`, and `settings.get`. While the vault is locked, `keys.list` SHALL return only the identifiers needed to determine that keys exist, `settings.get` SHALL return only the fields needed to render the lock screen and first-run flow, and `state.getLock` SHALL return only the locked state itself, without the inactivity deadline.

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

#### Scenario: A newly added privileged method is classified

- **WHEN** a new RPC method is added to the request union
- **THEN** the method is classified as privileged or reachable while locked
- **AND** an unclassified method is treated as privileged

### Requirement: Recorded Activity Postpones The Lock

The extension SHALL treat deliberate user action in an extension surface and completed privileged operations as activity that postpones the lock. Activity SHALL be recorded from the extension surfaces themselves, at the point of the deliberate action, and not only by a background method that no surface calls. Background bookkeeping, broadcast handling, relay traffic, lock-state polling from a locked UI, and rendering or updating a countdown display SHALL NOT count as activity. Activity reporting SHALL be throttled and MUST NOT keep the background worker alive for the sole purpose of tracking activity.

#### Scenario: User action in an extension surface records activity

- **GIVEN** the vault is unlocked
- **WHEN** the user unlocks the vault, selects a key, resolves an approval, or changes a setting from the popup, sidepanel, options tab, or approval window
- **THEN** the last-activity timestamp is updated
- **AND** the inactivity deadline is recomputed

#### Scenario: A produced signature records activity

- **GIVEN** the vault is unlocked
- **WHEN** an origin request is auto-signed without an approval prompt
- **THEN** the last-activity timestamp is updated

#### Scenario: An idle open surface does not postpone the lock

- **GIVEN** the vault is unlocked
- **AND** the options page is left open with no user interaction
- **WHEN** the inactivity window elapses
- **THEN** the vault is locked
- **AND** the open surface shows the lock screen

#### Scenario: Locked UI polling does not postpone the lock

- **GIVEN** the vault is locked
- **AND** a UI surface is polling lock state to render the lock screen
- **WHEN** lock state is queried repeatedly
- **THEN** the last-activity timestamp is not updated
- **AND** the vault remains locked

#### Scenario: Repeated interaction is throttled to one report

- **GIVEN** the vault is unlocked
- **AND** several extension surfaces are open
- **WHEN** the user interacts repeatedly within the throttle window
- **THEN** at most one activity report is sent per surface for that window
- **AND** the inactivity deadline is postponed

#### Scenario: Displaying the countdown does not postpone the lock

- **GIVEN** the vault is unlocked
- **AND** a surface is displaying the time remaining before auto-lock
- **WHEN** that display updates with no user interaction
- **THEN** the last-activity timestamp is not updated
- **AND** the vault locks when the inactivity window elapses

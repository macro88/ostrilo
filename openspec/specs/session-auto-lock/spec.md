# session-auto-lock Specification

## Purpose
Defines how the vault locks itself after a bounded period of inactivity, and how lock state is scheduled, enforced, reported, and failed closed across the extension.
## Requirements
### Requirement: Inactivity Locks The Vault

The extension SHALL lock the vault once the configured `autoLockMinutes` inactivity window elapses without recorded activity. Locking SHALL zeroize all decrypted key material held in the background, clear session grants, and record locked lock state.

#### Scenario: Inactivity window elapses

- **GIVEN** the vault is unlocked
- **AND** `autoLockMinutes` is `5`
- **WHEN** five minutes pass with no recorded activity
- **THEN** the vault is locked
- **AND** all decrypted key material held in the background is zeroized
- **AND** stored session grants are cleared
- **AND** extension UI surfaces show the lock screen

#### Scenario: Activity before the deadline postpones the lock

- **GIVEN** the vault is unlocked
- **AND** `autoLockMinutes` is `5`
- **WHEN** the user approves a signing request four minutes after the last recorded activity
- **THEN** the inactivity deadline is recomputed from the approval
- **AND** the vault remains unlocked

#### Scenario: Signing request after the deadline is refused

- **GIVEN** the vault was unlocked and the inactivity deadline has passed
- **WHEN** an origin requests `nostr.signEvent`
- **THEN** the request fails with the `locked` error code
- **AND** no signature is produced

### Requirement: Lock Enforcement Does Not Depend On A Timer Firing

The extension SHALL derive lock state from the stored last-activity timestamp on every privileged access, and MUST NOT treat a fired timer as the only mechanism that locks the vault. A last-activity timestamp in the future SHALL be treated as expired.

#### Scenario: Scheduled lock never runs

- **GIVEN** the vault is unlocked and the inactivity deadline has passed
- **AND** the scheduled lock did not run because the background worker was terminated
- **WHEN** any privileged operation is attempted
- **THEN** the vault reports locked
- **AND** the privileged operation is refused with the `locked` error code

#### Scenario: Device clock moves backwards

- **GIVEN** the vault is unlocked
- **WHEN** the stored last-activity timestamp is later than the current device clock
- **THEN** the stored timestamp is treated as expired
- **AND** the vault reports locked

#### Scenario: Deadline is re-evaluated after a shorter timeout is configured

- **GIVEN** the vault is unlocked with `autoLockMinutes` of `60` and the last activity was ten minutes ago
- **WHEN** the user changes `autoLockMinutes` to `5`
- **THEN** the inactivity deadline is re-evaluated against the new timeout
- **AND** the vault reports locked

### Requirement: Lock Scheduling Uses The Extension Alarms API

The extension SHALL schedule automatic locking with the extension alarms API and SHALL declare the `alarms` permission in the generated Chrome and Firefox manifests. The background SHALL NOT rely on `setTimeout` or `setInterval` to lock the vault. Alarm scheduling MUST NOT persist decrypted key material, passwords, or derived key material in order to survive background termination.

#### Scenario: Manifest declares the alarms permission

- **WHEN** the Chrome MV3 and Firefox MV2 manifests are generated
- **THEN** both declare the `alarms` permission alongside `storage`, `sidePanel`, and `windows`

#### Scenario: Alarm is armed on unlock and re-armed on activity

- **GIVEN** the vault is locked
- **WHEN** the user unlocks the vault
- **THEN** a lock alarm is scheduled for the configured inactivity deadline
- **AND** recorded activity re-arms the alarm for the recomputed deadline

#### Scenario: Platform alarm granularity does not weaken the lock

- **GIVEN** the platform clamps alarm scheduling to a minimum period
- **AND** the configured `autoLockMinutes` deadline falls between two alarm firings
- **WHEN** a privileged operation is attempted after the deadline but before the next alarm fires
- **THEN** the vault reports locked
- **AND** the operation is refused with the `locked` error code

#### Scenario: Scheduling does not persist secrets

- **GIVEN** the vault is unlocked and a lock alarm is scheduled
- **WHEN** stored extension data is inspected
- **THEN** no decrypted private key, password, or derived key material is present in session storage
- **AND** no decrypted private key, password, or derived key material is present in local or sync storage

### Requirement: Lock State Fails Closed

The extension SHALL report the vault as locked unless stored session lock state explicitly records an unlocked vault whose inactivity deadline has not passed. Missing, malformed, or unrecognised session lock state SHALL report locked.

#### Scenario: Session storage holds no lock state

- **GIVEN** the browser has restarted and session storage holds no lock state record
- **WHEN** lock state is queried
- **THEN** the vault reports locked

#### Scenario: Public key is not disclosed from a vault that was never unlocked

- **GIVEN** session storage holds no lock state record
- **AND** at least one key record exists in local storage
- **WHEN** a page calls `nostr.getPublicKey`
- **THEN** the request fails with the `locked` error code
- **AND** no public key is returned

#### Scenario: Malformed lock state reports locked

- **GIVEN** stored session lock state is present but does not explicitly record an unlocked vault
- **WHEN** lock state is queried
- **THEN** the vault reports locked

#### Scenario: Explicit unlocked state within the deadline reports unlocked

- **GIVEN** stored session lock state explicitly records an unlocked vault
- **AND** the inactivity deadline has not passed
- **WHEN** lock state is queried
- **THEN** the vault reports unlocked

### Requirement: Lock Status Is Reported Truthfully

The extension SHALL report locked, and not denied, whenever a privileged operation fails because the vault is locked or because no decrypted key material is held. When stored lock state claims unlocked but the background holds no decrypted key material, the extension SHALL record locked lock state and report locked.

#### Scenario: Background lost its key material

- **GIVEN** stored session lock state records an unlocked vault
- **AND** the background holds no decrypted key material because the worker was terminated
- **WHEN** an origin requests `nostr.signEvent`
- **THEN** stored lock state is corrected to locked
- **AND** the request fails with the `locked` error code
- **AND** the request does not fail with the `denied` error code

#### Scenario: Extension UI shows the lock screen after key material is lost

- **GIVEN** stored session lock state records an unlocked vault
- **AND** the background holds no decrypted key material
- **WHEN** the user opens the popup
- **THEN** the lock screen is shown
- **AND** the UI does not present an unlocked vault with no available keys

#### Scenario: Header does not claim an unenforced timeout

- **GIVEN** the vault is unlocked
- **WHEN** the header lock status is displayed
- **THEN** it reports the enforced inactivity timeout in effect
- **AND** it does not offer or display a never-lock state

### Requirement: Recorded Activity Postpones The Lock

The extension SHALL treat deliberate user action in an extension surface as activity that postpones the lock. Activity SHALL be recorded from the extension surfaces themselves, at the point of the deliberate action, and not only by a background method that no surface calls.

The extension SHALL additionally treat a signature produced for an origin request without an approval prompt as activity, but ONLY while the user is present at the machine as reported by the browser's idle state. Presence SHALL be determined from operating-system input, not from the request itself, and SHALL be evaluated over the configured inactivity window, so that a user who gave the machine any input inside that window counts as present. A reported state of idle or of an operating-system lock SHALL NOT count as presence.

Background bookkeeping, broadcast handling, relay traffic, lock-state polling from a locked UI, and rendering or updating a countdown display SHALL NOT count as activity. Activity reporting SHALL be throttled on every path that records it, including the background signing path, and MUST NOT keep the background worker alive for the sole purpose of tracking activity.

#### Scenario: User action in an extension surface records activity

- **GIVEN** the vault is unlocked
- **WHEN** the user unlocks the vault, selects a key, resolves an approval, or changes a setting from the popup, sidepanel, options tab, or approval window
- **THEN** the last-activity timestamp is updated
- **AND** the inactivity deadline is recomputed

#### Scenario: A signature records activity while the user is present

- **GIVEN** the vault is unlocked with an inactivity timeout of `5` minutes
- **AND** the user reacts to a post, which is signed without an approval prompt
- **AND** the user then reads for four minutes, giving the machine input as they read
- **WHEN** the user reacts to a second post
- **THEN** the second reaction is signed
- **AND** the last-activity timestamp is updated

#### Scenario: A signature does not record activity while the user is away

- **GIVEN** the vault is unlocked
- **AND** the browser reports the user as idle
- **WHEN** an origin request is signed without an approval prompt
- **THEN** the last-activity timestamp is not updated
- **AND** the inactivity deadline is unchanged

#### Scenario: A signature does not record activity behind an operating-system lock

- **GIVEN** the vault is unlocked
- **AND** the operating-system session is locked
- **WHEN** an origin request is signed without an approval prompt
- **THEN** the last-activity timestamp is not updated

#### Scenario: A signing origin cannot hold the vault open once the user leaves

- **GIVEN** the vault is unlocked with an inactivity timeout of `5` minutes
- **AND** an origin whose requests are signed without an approval prompt sends one request every minute
- **WHEN** the user leaves the machine and gives it no input for the whole window
- **THEN** the vault is locked
- **AND** subsequent requests from that origin are refused with the `locked` error code

#### Scenario: Signature activity is throttled

- **GIVEN** the vault is unlocked and the user is present
- **WHEN** an origin's requests are signed repeatedly within the throttle window
- **THEN** at most one activity report is recorded for that window
- **AND** the inactivity deadline is postponed

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

### Requirement: Page-Originated Activity Requires Attested User Presence

The extension SHALL NOT allow a web page to postpone the inactivity deadline by its own action alone. Where a page-originated request postpones the deadline, the postponement SHALL additionally require evidence of user presence that the page cannot produce, cannot influence, and cannot infer. A page-reachable method SHALL NOT record activity directly.

The deadline is the bound on how long an unattended unlocked vault stays open. A page that can move it on its own is an unbounded session held open by something other than a person, so the requirement is on the *source of the evidence*, not on which method was called.

#### Scenario: A page cannot reach the activity method directly

- **GIVEN** the vault is unlocked
- **WHEN** a web page attempts to reach the activity-recording method through the content script
- **THEN** the call is refused
- **AND** the last-activity timestamp is not updated

#### Scenario: Request volume alone does not postpone the deadline

- **GIVEN** the vault is unlocked
- **AND** the browser reports the user as idle
- **WHEN** a page sends signing requests continuously for longer than the inactivity window
- **THEN** the vault is locked at the end of that window
- **AND** no request in the sequence postponed the deadline

#### Scenario: Presence evidence does not come from the request

- **GIVEN** the vault is unlocked
- **WHEN** the extension decides whether a page-originated signature postpones the deadline
- **THEN** the decision reads the browser's idle state
- **AND** the decision does not read the request's origin, kind, frequency, or trust level as evidence of presence

#### Scenario: A newly added activity-recording path is classified

- **WHEN** a code path that records activity is added
- **THEN** the path is classified as reachable or unreachable from a page-originated request
- **AND** a page-reachable path that does not require attested user presence is not permitted to record activity
- **AND** a path that cannot be confirmed unreachable is treated as page-reachable

### Requirement: Session End Leaves The Vault Locked

The extension SHALL leave the vault locked after browser close, browser start, extension install, and extension update, and SHALL clear session grants in each case.

#### Scenario: Browser is closed and reopened

- **GIVEN** the vault was unlocked before the browser was closed
- **WHEN** the browser is reopened and the extension starts
- **THEN** stored lock state records a locked vault
- **AND** session grants are cleared
- **AND** the user must enter the password to unlock

#### Scenario: Extension is installed or updated

- **WHEN** the extension is installed or updated
- **THEN** stored lock state records a locked vault
- **AND** session grants are cleared

#### Scenario: Machine sleeps past the deadline

- **GIVEN** the vault is unlocked
- **WHEN** the machine sleeps for longer than the configured inactivity window and then wakes
- **THEN** the vault reports locked on the next privileged access
- **AND** no signature is produced without a new unlock

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

### Requirement: Pending Approvals Do Not Survive A Lock

The extension SHALL resolve pending approval requests as denied when the vault locks, SHALL clear the approval badge, and SHALL refuse `approval.resolve` with the `locked` error code while the vault is locked.

#### Scenario: Vault locks with a pending approval

- **GIVEN** the vault is unlocked and an approval request is pending
- **WHEN** the inactivity window elapses and the vault locks
- **THEN** the pending request is resolved as denied
- **AND** the approval badge is cleared
- **AND** the requesting page receives a failure rather than a signature

#### Scenario: Approval resolution is refused while locked

- **GIVEN** the vault is locked
- **WHEN** `approval.resolve` is called with an `allow` action
- **THEN** the call fails with the `locked` error code
- **AND** no signature is produced

### Requirement: Auto-Lock Timeout Has One Shipped Default And A Bounded Range

The extension SHALL define one shipped default for `autoLockMinutes` in a single location and SHALL use it in both the domain defaults and the settings service. Accepted values for `autoLockMinutes` SHALL be whole minutes from `1` to `60` inclusive, and a never-lock value SHALL NOT be accepted or selectable. Accepted values for `sessionTTLMinutes` SHALL be from `0` to `60` inclusive, where `0` means the grant lasts until the vault locks. Stored values outside the accepted range SHALL be normalized on read.

#### Scenario: Fresh profile uses the single shipped default

- **GIVEN** no settings are stored
- **WHEN** settings are first read
- **THEN** `autoLockMinutes` is the single shipped default
- **AND** the domain defaults and the settings service report the same value

#### Scenario: Never-lock value is rejected

- **WHEN** `settings.update` is called with `autoLockMinutes` of `0`
- **THEN** the call fails validation
- **AND** stored settings are unchanged

#### Scenario: Out-of-range value is rejected

- **WHEN** `settings.update` is called with `autoLockMinutes` of `1440`
- **THEN** the call fails validation
- **AND** stored settings are unchanged

#### Scenario: Stored never-lock value is normalized

- **GIVEN** stored settings carry `autoLockMinutes` of `0` from an earlier version
- **WHEN** settings are read
- **THEN** `autoLockMinutes` is normalized to the shipped default
- **AND** the normalized value is persisted

#### Scenario: Session grant timeout stays bounded by the session

- **GIVEN** `sessionTTLMinutes` is `0`
- **WHEN** a session grant is created and the vault later locks
- **THEN** the grant is cleared
- **AND** the grant does not apply after the next unlock

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


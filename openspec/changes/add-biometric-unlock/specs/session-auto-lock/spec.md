## MODIFIED Requirements

### Requirement: Privileged RPC Methods Require An Unlocked Vault

The extension SHALL refuse privileged RPC methods with the `locked` error code while the vault is locked, and SHALL enforce this in the background handlers rather than relying on UI gating. Privileged methods SHALL include `settings.update`, `policy.setOrigin`, `policy.setKindRule`, `policy.setSession`, `policy.clearSession`, `policy.removeOrigin`, `policy.evaluate`, `vault.select`, `vault.renameKey`, `vault.deleteKey`, `vault.sign`, `vault.biometricEnroll`, `nostr.getPublicKey`, `nostr.signEvent`, `approval.resolve`, all `activity.*` methods, and all `profile.*` methods. Methods that SHALL remain reachable while locked are `vault.unlock`, `vault.lock`, `vault.biometricStatus`, `vault.biometricUnlockRequest`, `vault.biometricUnlock`, `vault.biometricForget`, `state.getLock`, `state.touch`, `keys.list`, `crypto.evaluatePassword`, `crypto.parsePrivateKey`, `vault.generate`, `vault.import`, `vault.reveal`, and `settings.get`. `vault.generate` and `vault.import` are reachable because creating or importing the first key happens before there is a vault to unlock and both verify the password themselves; `vault.reveal` is reachable because it re-verifies the password itself, which is a stronger check than the lock gate. While the vault is locked, `keys.list` SHALL return only the identifiers needed to determine that keys exist, `settings.get` SHALL return only the fields needed to render the lock screen and first-run flow, `state.getLock` SHALL return only the locked state itself, without the inactivity deadline, plus the non-secret lock reason and, for an inactivity lock, the whole minutes of the timeout that elapsed, when the background recorded them, and `vault.biometricStatus` SHALL return only whether a usable factor exists, the date it was enrolled and why it is unusable, and SHALL NOT return a credential identifier, a credential label, or any stored wrapping material. `vault.biometricUnlockRequest` SHALL return only what an authenticator needs to be asked — the credential identifier, the pseudo-random-function salt and the transports — and SHALL NOT return the wrapping.

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

#### Scenario: Biometric status, unlock, and forget stay reachable while locked

- **GIVEN** the vault is locked
- **AND** a biometric factor is enrolled
- **WHEN** `vault.biometricStatus`, `vault.biometricUnlockRequest`, `vault.biometricUnlock`, and `vault.biometricForget` are called
- **THEN** each call is served rather than refused with the `locked` error code
- **AND** the user can complete a biometric unlock or forget the factor without first entering the password

#### Scenario: Biometric enrolment is refused while locked

- **GIVEN** the vault is locked
- **WHEN** `vault.biometricEnroll` is called
- **THEN** the call fails with the `locked` error code
- **AND** no factor record is written

#### Scenario: Locked biometric status does not disclose the credential

- **GIVEN** the vault is locked
- **AND** a biometric factor is enrolled with a credential identifier and a label
- **WHEN** `vault.biometricStatus` is called
- **THEN** the response reports only whether an unlock can be attempted, the date the factor was enrolled, and why an unlock cannot be attempted
- **AND** no credential identifier, credential label, or wrapping material is returned

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

### Requirement: Session Lock State Names The Factor That Opened It

Stored session lock state SHALL record whether the session was opened by the password or by a biometric factor. A biometric session SHALL be subject to the same inactivity deadline, the same activity re-arming, and the same fail-closed lock-state reads as a password session, and SHALL NOT extend, suspend, or re-arm the deadline by any mechanism a password session does not have. Session lock state whose recorded factor is missing SHALL be read as a password session, so a session opened by a build that predates this field is not force-locked on upgrade. An unrecognised factor value SHALL report locked.

#### Scenario: A biometric unlock records its factor

- **GIVEN** the vault is locked
- **WHEN** the user completes a biometric unlock
- **THEN** stored session lock state records an unlocked vault opened by a biometric factor
- **AND** a lock alarm is scheduled for the configured inactivity deadline

#### Scenario: A biometric session locks on the same deadline

- **GIVEN** the vault was unlocked by a biometric factor
- **AND** `autoLockMinutes` is `5`
- **WHEN** five minutes pass with no recorded activity
- **THEN** the vault is locked
- **AND** all decrypted key material held in the background is zeroized
- **AND** stored session grants are cleared

#### Scenario: Activity in a biometric session re-arms the lock the same way

- **GIVEN** the vault was unlocked by a biometric factor
- **WHEN** the user resolves an approval before the inactivity deadline
- **THEN** the inactivity deadline is recomputed from the approval
- **AND** the lock alarm is re-armed for the recomputed deadline

#### Scenario: Lock state with an unrecognised factor reports locked

- **GIVEN** stored session lock state claims an unlocked vault and names no factor, or names a factor this build does not recognise
- **WHEN** lock state is queried
- **THEN** the vault reports locked
- **AND** privileged operations are refused with the `locked` error code

#### Scenario: Auto-lock fires while a ceremony window is open

- **GIVEN** the vault is unlocked
- **AND** a biometric ceremony window is open
- **WHEN** the inactivity deadline passes and the vault locks
- **THEN** all decrypted key material held in the background is zeroized
- **AND** a later unlock request from that window is evaluated as an ordinary unlock of a locked vault, under the same throttle, rehearsal and first-unlock rules
- **AND** the open window confers no authority the lock screen would not

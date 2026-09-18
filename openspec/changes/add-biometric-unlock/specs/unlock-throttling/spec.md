## MODIFIED Requirements

### Requirement: Failed Unlock Attempts Are Throttled By The Background Worker

The background worker SHALL count failed vault unlock attempts and SHALL refuse an unlock attempt while a backoff delay is active, before performing any key derivation. Every unlock path SHALL share one global failure counter; there SHALL NOT be a separate counter, a separate schedule or a separate cap per credential type. The biometric unlock path SHALL check the shared counter before minting a challenge, before consuming a challenge and before any key derivation or unwrapping. It SHALL record a failure for every background verification failure, and SHALL record a success only when the vault is genuinely unlocked. A user cancellation of an authenticator ceremony never reaches the background worker and SHALL NOT record a failure.

#### Scenario: Active delay refuses the attempt before key derivation

- **GIVEN** a backoff delay is active
- **WHEN** a `vault.unlock` request arrives
- **THEN** the handler returns an error with machine code `rate_limited`
- **AND** the error data reports the remaining wait time
- **AND** no key derivation is performed for that attempt

#### Scenario: Ordinary typos are not punished

- **GIVEN** no prior failed attempts
- **WHEN** the user submits an incorrect password up to three times
- **THEN** each attempt is evaluated with no added delay
- **AND** the error remains the existing generic incorrect-password result

#### Scenario: Successful unlock clears the counter

- **GIVEN** failed attempts have accumulated
- **WHEN** the user unlocks successfully
- **THEN** the persisted failure count is reset to zero
- **AND** no delay applies to the next attempt

#### Scenario: Password failures delay the biometric path

- **GIVEN** failed password unlock attempts have driven the shared counter into an active backoff delay
- **WHEN** a biometric unlock is requested
- **THEN** the request is refused with machine code `rate_limited`
- **AND** the error data reports the same remaining wait time the password path reports
- **AND** no challenge is minted

#### Scenario: The counter is checked before a challenge is consumed

- **GIVEN** a backoff delay is active and a challenge is present in session storage
- **WHEN** a biometric unlock completion request arrives
- **THEN** the request is refused before the challenge is read
- **AND** the challenge remains available for a later attempt made after the delay expires
- **AND** no wrapping key is derived and no wrapping is opened

#### Scenario: Background verification failures count against the shared counter

- **GIVEN** no prior failed attempts
- **WHEN** biometric unlock attempts fail background verification repeatedly
- **THEN** each failure increments the shared failure count by one
- **AND** the same exponential schedule and cap apply as for password failures

#### Scenario: Successful biometric unlock clears the counter

- **GIVEN** failed attempts have accumulated
- **WHEN** a biometric unlock completes and the vault is unlocked
- **THEN** the persisted failure count is reset to zero
- **AND** no delay applies to the next attempt on either path

#### Scenario: A cancelled ceremony records nothing

- **GIVEN** a biometric unlock ceremony in progress
- **WHEN** the user dismisses the authenticator prompt or closes the ceremony window
- **THEN** no completion request reaches the background worker
- **AND** the persisted failure count is unchanged
- **AND** no backoff delay is started

### Requirement: Throttle State Survives Restarts And Is Not Resettable From The UI

The throttle state SHALL be persisted in extension local storage so it survives MV3 service-worker termination, popup close and browser restart. The extension SHALL NOT expose any RPC method that clears or decrements the failure count. This SHALL include every biometric factor method: enrolling a factor and forgetting a factor SHALL leave the failure count and any active delay untouched.

#### Scenario: Closing the popup does not reset the throttle

- **GIVEN** a backoff delay is active
- **WHEN** the user closes and reopens the popup
- **THEN** the delay is still active with its remaining time preserved

#### Scenario: Service-worker restart does not reset the throttle

- **GIVEN** a backoff delay is active
- **WHEN** the MV3 background service worker is terminated and restarted
- **THEN** the delay is still active with its remaining time preserved
- **AND** the remaining time is computed from a persisted timestamp rather than an in-memory timer

#### Scenario: No RPC method clears the counter

- **WHEN** the set of available RPC methods is enumerated
- **THEN** no method clears, decrements or overrides the failure count
- **AND** only a successful unlock or the quiet-period decay resets it

#### Scenario: Forgetting a biometric factor does not clear the counter

- **GIVEN** a backoff delay is active and a biometric factor is enrolled
- **WHEN** the user forgets the factor from the locked screen
- **THEN** the factor record is deleted
- **AND** the persisted failure count is unchanged
- **AND** the delay is still active with its remaining time preserved

#### Scenario: Enrolling a biometric factor does not clear the counter

- **GIVEN** failed attempts have accumulated
- **WHEN** a biometric factor is enrolled
- **THEN** the persisted failure count is unchanged
- **AND** the next failed unlock attempt on either path continues the existing schedule

#### Scenario: Throttling does not defend against offline attack

- **WHEN** an attacker copies the encrypted key records out of extension local storage
- **THEN** the throttle does not apply to their offline guessing
- **AND** the documented mitigation for that attack is the key-derivation work factor raised by `harden-vault-key-derivation`

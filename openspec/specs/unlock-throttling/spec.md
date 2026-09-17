# unlock-throttling Specification

## Purpose

Slows online guessing of the vault password by throttling failed unlock attempts in the background worker. Covers the exponential backoff schedule and its cap, persistence across service-worker termination and browser restart, the absence of any RPC that resets the counter, and how the lock screen presents the delay without becoming a password oracle.

## Requirements

### Requirement: Failed Unlock Attempts Are Throttled By The Background Worker

The background worker SHALL count failed vault unlock attempts and SHALL refuse an unlock attempt while a backoff delay is active, before performing any key derivation.

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

### Requirement: Backoff Grows Exponentially With A Hard Cap

The throttle SHALL increase the delay exponentially after the free attempts and SHALL cap it. The extension SHALL NOT permanently lock the vault and SHALL NOT delete key material in response to failed attempts.

#### Scenario: Delay grows with each further failure

- **GIVEN** three failed attempts have already occurred
- **WHEN** the fourth, fifth and sixth attempts fail
- **THEN** each attempt sets a longer delay than the previous one
- **AND** each delay is at least three times the previous delay

#### Scenario: Delay stops growing at the cap

- **WHEN** failures continue beyond the exponential schedule
- **THEN** the delay stops increasing at 60 minutes
- **AND** the vault is never permanently locked
- **AND** no encrypted key record is deleted or rewritten

#### Scenario: Counter decays after a quiet period

- **GIVEN** failed attempts have accumulated
- **WHEN** 24 hours pass with no further failed attempt
- **THEN** the failure count resets to zero
- **AND** the next attempt is treated as a first attempt

### Requirement: Throttle State Survives Restarts And Is Not Resettable From The UI

The throttle state SHALL be persisted in extension local storage so it survives MV3 service-worker termination, popup close and browser restart. The extension SHALL NOT expose any RPC method that clears or decrements the failure count.

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

#### Scenario: Throttling does not defend against offline attack

- **WHEN** an attacker copies the encrypted key records out of extension local storage
- **THEN** the throttle does not apply to their offline guessing
- **AND** the documented mitigation for that attack is the key-derivation work factor raised by `harden-vault-key-derivation`

### Requirement: A Locked-Out User Can See And Wait Out The Delay

The lock screen SHALL show the remaining delay and SHALL describe recovery, without revealing anything about the correctness of the attempted password.

#### Scenario: Lock screen shows a live countdown

- **GIVEN** a backoff delay is active
- **WHEN** the lock screen renders
- **THEN** the remaining time is shown to the user
- **AND** the unlock control is disabled until the delay expires
- **AND** the countdown resumes from the persisted deadline after the popup is reopened

#### Scenario: Recovery is explained without destructive advice

- **GIVEN** a backoff delay is active
- **WHEN** the lock screen renders
- **THEN** the UI explains the user can wait for the delay to expire
- **AND** the UI explains the saved `nsec` backup is the recovery path for a forgotten password
- **AND** the UI does not offer deleting the vault as a recovery step

#### Scenario: Throttle message is not a password oracle

- **WHEN** an attempt is refused by the throttle
- **THEN** the message does not indicate whether the submitted password was partially correct
- **AND** the message does not reveal how many keys the vault holds

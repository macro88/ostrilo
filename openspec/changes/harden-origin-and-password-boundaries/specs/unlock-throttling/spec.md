## ADDED Requirements

### Requirement: Every Master Password Verification Shares The Throttle

Every background path that verifies the master password SHALL consult the persisted unlock throttle before any key derivation, and SHALL record against the same counter. This includes vault unlock, password re-authentication for high-risk actions, private key reveal, and key generation or import when a vault already exists. A refused attempt SHALL return the `rate_limited` error code with the remaining wait. An incorrect password SHALL record a failure. A verified password SHALL reset the counter on any path. Key generation or import that creates the first vault verifies no existing password and SHALL NOT be charged.

#### Scenario: Re-authentication is refused during a backoff

- **GIVEN** failed unlock attempts have set an active backoff delay
- **WHEN** a high-risk action is requested with any password
- **THEN** the response carries the `rate_limited` error code with the remaining wait
- **AND** no key derivation is performed

#### Scenario: Reveal attempts count toward the same backoff

- **GIVEN** no prior failed attempts
- **WHEN** `vault.reveal` is called repeatedly with incorrect passwords past the free attempts
- **THEN** a backoff delay becomes active
- **AND** a subsequent `vault.unlock` is refused with `rate_limited` until it elapses

#### Scenario: Import into an existing vault is throttled

- **GIVEN** a vault exists and a backoff delay is active
- **WHEN** `vault.import` is called
- **THEN** the response carries the `rate_limited` error code
- **AND** no key is stored

#### Scenario: Creating the first vault is not charged

- **GIVEN** no vault exists
- **WHEN** `vault.generate` creates the first key
- **THEN** the throttle's failure count is unchanged

#### Scenario: Successful re-authentication resets the counter

- **GIVEN** failed attempts have accumulated below the free-attempt limit
- **WHEN** a high-risk action is authorised with the correct password
- **THEN** the persisted failure count is zero

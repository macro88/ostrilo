## ADDED Requirements

### Requirement: A Failed Unlock Is Never Presented As A Success

The unlock path MUST distinguish success from failure to its caller, and the lock screen MUST NOT run any success behaviour for a failed attempt.

#### Scenario: Wrong password does not take the success path

- **GIVEN** the vault holds at least one key and is locked
- **WHEN** the user submits an incorrect password
- **THEN** the lock screen MUST remain displayed
- **AND** the unlock success callback MUST NOT be invoked
- **AND** an error MUST be displayed to the user

#### Scenario: Correct password takes the success path exactly once

- **GIVEN** the vault holds at least one key and is locked
- **WHEN** the user submits the correct password
- **THEN** the unlock success callback MUST be invoked
- **AND** the entered password MUST be cleared from component state

#### Scenario: The unlock contract reports failure to its caller

- **GIVEN** any caller of the key-manager unlock operation
- **WHEN** the underlying RPC fails for any reason
- **THEN** the operation MUST convey that failure to the caller
- **AND** it MUST NOT resolve in a way that is indistinguishable from success

### Requirement: The User Is Told Why An Unlock Failed

The lock screen SHALL surface the reason the background gave for a failed unlock, using the structured error code and detail from the RPC response rather than a generic message.

#### Scenario: Incorrect password is reported as such

- **WHEN** an unlock attempt fails because the password is incorrect
- **THEN** the lock screen displays that the password was incorrect

#### Scenario: Throttled attempt reports the wait

- **GIVEN** the unlock throttle has imposed a delay
- **WHEN** the user attempts to unlock during that delay
- **THEN** the lock screen displays that attempts are paused
- **AND** it displays how long the user must wait
- **AND** it MUST NOT present this as an incorrect password

#### Scenario: Absent vault is distinguished from a wrong password

- **GIVEN** no vault has been created
- **WHEN** an unlock is attempted
- **THEN** the lock screen states that no vault exists and directs the user to create or import a key
- **AND** it MUST NOT state that the password was incorrect

#### Scenario: Damaged vault is distinguished from a wrong password

- **GIVEN** the stored vault cannot be opened because its records are damaged or its version is unsupported
- **WHEN** an unlock is attempted with the correct password
- **THEN** the lock screen states that the vault could not be opened
- **AND** it MUST NOT state that the password was incorrect

#### Scenario: The displayed reason comes from the structured error

- **WHEN** the lock screen renders an unlock failure
- **THEN** the message MUST be derived from the RPC error code and its detail field
- **AND** it MUST NOT be derived from the exception's `message` property, which carries only a machine identifier

#### Scenario: No failure reason discloses key material

- **WHEN** any unlock failure is displayed
- **THEN** the message MUST NOT contain the entered password, any private key, or any value derived from either

### Requirement: Brute-Force Resistance Is Not Claimed In The UI

The lock screen MUST NOT present any component-state counter as a protection against repeated unlock attempts. Rate limiting is enforced in the background, where a caller driving the message bus directly cannot skip it.

#### Scenario: No component-state attempt counter

- **GIVEN** the lock screen
- **WHEN** unlock attempts fail repeatedly
- **THEN** the UI MUST NOT maintain an attempt count in component state as a security control
- **AND** any warning shown to the user about repeated attempts MUST reflect the background throttle state rather than a count the UI keeps

#### Scenario: Throttle survives the surface being closed and reopened

- **GIVEN** the background throttle has imposed a delay
- **WHEN** the user closes and reopens the popup
- **THEN** the delay is still in force
- **AND** the lock screen reports it

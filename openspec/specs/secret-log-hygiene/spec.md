# secret-log-hygiene Specification

## Purpose

Keeps secret material out of every log sink and keeps production bundles free of console output. Covers what RPC diagnostics may record, the prohibition on logging keys, passwords and decrypted plaintext at any log level, and the build-time guarantee that shipped Chrome and Firefox bundles contain no `console` or `debugger` statements.

## Requirements

### Requirement: Secret Material Is Never Logged

The extension SHALL NOT write private-key material, passwords, derived key material, or decrypted plaintext to any log sink, at any log level, in any build variant. This includes `nsec` strings, hex private keys, raw key byte arrays, and password input.

#### Scenario: Revealing a key for backup logs nothing sensitive

- **GIVEN** the vault is unlocked
- **WHEN** the user re-enters their password to reveal their key for backup
- **THEN** the `nsec` and hex private key are shown only in the UI
- **AND** no log sink receives the `nsec`, the hex key, or the password

#### Scenario: Import validation logs nothing sensitive

- **GIVEN** a user pastes a private key into an import form
- **WHEN** the input is validated
- **THEN** no log sink receives the pasted key or any encoding of it

### Requirement: RPC Diagnostics Log Method And Outcome Only

The messaging client and the background listener SHALL limit RPC diagnostics to the method name and the outcome. Request bodies, response bodies, response `data`, thrown error objects, and any field derived from them SHALL NOT be logged.

#### Scenario: Successful response is logged as method and status

- **GIVEN** an RPC call succeeds
- **WHEN** the client records a diagnostic line
- **THEN** the line contains the method name and a success indicator
- **AND** the line does not contain the response envelope or its `data`

#### Scenario: Failed response is logged as method and machine error code

- **GIVEN** an RPC call fails
- **WHEN** the client records a diagnostic line
- **THEN** the line contains the method name and the machine error code
- **AND** the line does not contain the error object, its stack, or the request payload

#### Scenario: Transport failure is logged without the request

- **GIVEN** the background is unreachable and `sendMessage` throws
- **WHEN** the client records a diagnostic line
- **THEN** the line identifies the method and that the failure was a transport failure
- **AND** the line does not contain the request payload

### Requirement: Production Builds Contain No Console Output

Production Chrome and Firefox builds SHALL contain no `console` calls and no `debugger` statements in any emitted bundle.

#### Scenario: Chrome production bundle is free of console calls

- **GIVEN** a production Chrome build has completed
- **WHEN** the emitted bundles are scanned
- **THEN** no `console.log`, `console.warn`, `console.error`, or `console.debug` call sites remain
- **AND** no `debugger` statement remains

#### Scenario: Firefox production bundle is free of console calls

- **GIVEN** a production Firefox build has completed
- **WHEN** the emitted bundles are scanned
- **THEN** no `console` call sites and no `debugger` statements remain

#### Scenario: Development builds keep diagnostics

- **GIVEN** a development build or dev server session
- **WHEN** the extension runs
- **THEN** permitted diagnostics still appear so developers can debug locally

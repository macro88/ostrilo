## MODIFIED Requirements

### Requirement: Numeric Code Mapping

The RPC system SHALL map canonical machine error codes to numeric error codes. Every canonical machine error code SHALL be introduced with four edits applied together: a documentation comment immediately preceding its constant, an entry in the numeric mapping, an entry in the default message table, and a section in the public error-code document. A numeric code, once mapped, SHALL NOT be reassigned to a different machine code.

#### Scenario: Protocol-style numeric codes for request/method/params
- **GIVEN** an RPC request is malformed
- **WHEN** the router rejects it
- **THEN** the numeric `error.code` SHOULD align with JSON-RPC conventions:
  - invalid request -> `-32600`
  - unknown method -> `-32601`
  - invalid params -> `-32602`

#### Scenario: Application numeric codes for domain errors
- **GIVEN** an application-level error occurs
- **WHEN** the error is returned
- **THEN** the numeric `error.code` SHALL be stable and documented
- **AND** application errors SHOULD use the JSON-RPC server error range, such as `-32000` to `-32099`

#### Scenario: Every machine code carries all four edits
- **GIVEN** any member of `RPC_ERROR_CODES`
- **WHEN** the codebase and documentation are inspected
- **THEN** a documentation comment SHALL immediately precede its constant, stating when the code is returned and how it differs from the codes it could be confused with
- **AND** the code SHALL appear in the numeric mapping table
- **AND** the code SHALL appear in the default message table
- **AND** the code SHALL have its own section in the public error-code document

#### Scenario: Biometric unavailability code
- **GIVEN** the biometric status method is invoked
- **WHEN** the feature is not compiled into this build, or the platform or device offers no usable authenticator
- **THEN** the error response SHALL use machine code `"biometric_unavailable"`
- **AND** the numeric `error.code` SHALL be `-32007`
- **AND** the message SHALL be "Biometric unlock is unavailable" or a documented equivalent
- **AND** this code SHALL NOT be returned by an unlock or enrolment attempt, because whether a factor is enrolled is not a fact a refusal may disclose

#### Scenario: Biometric refusal code
- **GIVEN** a biometric unlock or enrolment request reaches the background
- **WHEN** the request is refused for any reason, including that the vault holds no enrolled factor
- **THEN** the error response SHALL use machine code `"biometric_rejected"`
- **AND** the numeric `error.code` SHALL be `-32008`
- **AND** the message SHALL be "Biometric unlock was refused" or a documented equivalent

#### Scenario: Numeric slots are not reused
- **GIVEN** the numeric mapping table
- **WHEN** a new machine code is added
- **THEN** it SHALL take a numeric slot no other machine code holds
- **AND** the numeric value of an existing machine code SHALL NOT change

---

### Requirement: Security Considerations

The RPC error code system SHALL maintain security boundaries and prevent information leakage. An error response SHALL NOT act as an oracle for the existence, identity, or state of stored credentials or enrolled authentication factors, nor for which step of a multi-step verification failed.

#### Scenario: No sensitive data in error codes
- **GIVEN** any error response
- **WHEN** the error code is set
- **THEN** the code SHALL NOT reveal sensitive information like key existence, internal paths, or security policies
- **AND** SHALL use generic codes for security-related failures

#### Scenario: Error data sanitization
- **GIVEN** an error response includes `error.data`
- **WHEN** the response crosses a security boundary, such as background to content script
- **THEN** the data SHALL NOT include stack traces, internal file paths, or sensitive state
- **AND** it SHALL only include safe user-actionable information

#### Scenario: Origin validation errors
- **GIVEN** an origin fails validation
- **WHEN** returning an error
- **THEN** the error SHALL NOT reveal internal origin policies or whitelists
- **AND** SHALL use generic `"invalid_origin"` code without leaking policy details

#### Scenario: Every biometric refusal collapses to one code and one detail
- **GIVEN** a biometric unlock or enrolment request that the background refuses
- **WHEN** the failure originates in the ceremony, the challenge, the assertion signature, an authenticator-data flag, a credential-identifier mismatch, the key unwrap, or the envelope verifier
- **THEN** the error response SHALL use machine code `"biometric_rejected"` in every case
- **AND** `error.data.details` SHALL be the same fixed caller-safe string in every case
- **AND** the response SHALL NOT name the step that failed, the credential, or the factor

#### Scenario: A refusal does not disclose enrolment state
- **GIVEN** two vaults, one with a biometric factor enrolled and one without
- **WHEN** a biometric unlock is attempted against each with material that does not verify
- **THEN** the two responses SHALL be indistinguishable in code, message, and details
- **AND** the caller SHALL NOT learn whether a factor is enrolled

#### Scenario: Unavailability is reported without describing the device
- **GIVEN** a biometric method refused as unavailable
- **WHEN** the error response is constructed
- **THEN** it SHALL NOT name an authenticator, a modality, a transport, or a credential
- **AND** it SHALL NOT distinguish a build without the feature from a device without a usable authenticator

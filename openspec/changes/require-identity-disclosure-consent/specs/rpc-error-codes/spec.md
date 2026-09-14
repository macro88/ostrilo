## MODIFIED Requirements

### Requirement: Authentication and Authorization Error Codes

The RPC system SHALL provide standard error codes for authentication and authorization failures, and SHALL distinguish a refusal to disclose the user's identity from a refusal to perform a requested operation.

#### Scenario: Locked vault error
- **GIVEN** an RPC request requires access to private keys
- **WHEN** the vault is locked
- **THEN** the error response SHALL use code `"locked"`
- **AND** SHALL NOT include sensitive information in the error details

#### Scenario: Policy denial error
- **GIVEN** an RPC request is evaluated against origin policy
- **WHEN** the policy explicitly denies the operation
- **THEN** the error response SHALL use code `"denied"`
- **AND** MAY include policy reason in `error.data.details` for debugging

#### Scenario: Approval required error
- **GIVEN** an RPC request requires user approval
- **WHEN** the approval queue is not configured or available
- **THEN** the error response SHALL use code `"needs_approval"`
- **AND** SHALL NOT block indefinitely waiting for approval

#### Scenario: Identity disclosure refused error
- **GIVEN** an RPC request would disclose the user's public key to an origin
- **WHEN** the user refuses, or a remembered refusal applies
- **THEN** the error response SHALL use a code specific to identity disclosure
- **AND** that code SHALL differ from `"denied"`, so a client can distinguish a refusal to reveal the user's identity from a refusal to sign
- **AND** SHALL NOT include the public key or any part of it in the error details

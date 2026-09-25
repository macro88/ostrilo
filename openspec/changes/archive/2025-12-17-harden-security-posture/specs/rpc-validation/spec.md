# RPC Validation

## ADDED Requirements

### Requirement: Strict Input Validation
All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing.

#### Scenario: Invalid Activity Filter
**Given** an `activity.filterBy` RPC request
**When** the request contains invalid types (e.g., string for limit) or extra fields
**Then** the handler MUST return an `invalid_params` error
**And** MUST NOT pass the data to the service layer

#### Scenario: Invalid Approval Action
**Given** an `approval.handleRequest` RPC request
**When** the request contains a missing `requestId` or invalid `decision`
**Then** the handler MUST return an `invalid_params` error

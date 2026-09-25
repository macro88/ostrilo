# rpc-validation Capability Specification (Delta)

## Purpose
Ensure RPC requests are validated strictly and rejected consistently using the standardized RPC error model.

## MODIFIED Requirements

### Requirement: Strict Input Validation

All RPC handlers MUST validate the structure and content of incoming messages against a strict schema before processing.

#### Scenario: Invalid Activity Filter
**Given** an `activity.filterBy` RPC request  
**When** the request contains invalid types (e.g., string for limit) or extra fields  
**Then** the handler MUST return an error with machine code `invalid_params`  
**And** the numeric error code SHOULD be `-32602`  
**And** the handler MUST NOT pass the data to the service layer

#### Scenario: Invalid Approval Action
**Given** an `approval.resolve` RPC request  
**When** the request contains a missing `requestId` or invalid `action`  
**Then** the handler MUST return an error with machine code `invalid_params`  
**And** the numeric error code SHOULD be `-32602`

#### Scenario: Validation errors return structured error objects
**Given** an RPC request fails validation  
**When** constructing the error response  
**Then** the response MUST use the structured JSON-RPC error object shape  
**And** it MUST include `error.data.errorCode`  
**And** it MAY include a safe `error.data.details` explaining the first validation issue

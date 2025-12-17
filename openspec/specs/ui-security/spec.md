# ui-security Specification

## Purpose
TBD - created by archiving change harden-security-posture. Update Purpose after archive.
## Requirements
### Requirement: Ephemeral Input State
The UI MUST NOT store sensitive user inputs (passwords, private keys) in persistent component state (e.g., React `useState`).

#### Scenario: Password Entry
**Given** a password input field
**When** the user types their password
**Then** the value MUST be managed via a DOM reference (`useRef`) or similar mechanism
**And** MUST NOT trigger re-renders that expose the value to dev tools

### Requirement: Secure Key Display
The UI MUST NOT persist revealed private keys in component state.

#### Scenario: Key Backup
**Given** the user is backing up a newly generated key
**When** the key is revealed
**Then** it MUST be fetched via a secure RPC call
**And** displayed using a non-persistent mechanism
**And** cleared from the DOM immediately when the user navigates away


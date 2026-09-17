# UI Architecture Specification

## Purpose

Define shared UI architecture patterns for extension navigation and runtime broadcast events.

## Requirements

### Requirement: Centralized Navigation Logic

The application MUST use a centralized hook for handling navigation state and listening to navigation-related broadcast events. Navigation that enters or leaves a surface capable of holding key material MUST also route through that hook, so there is exactly one code path that sets up and tears down a key-handling surface.

#### Scenario: Switching to Activity Tab

- **GIVEN** the application is running
- **WHEN** a navigation event is broadcast, such as `SWITCH_TO_ACTIVITY`
- **THEN** the application MUST handle the state change via a centralized hook (`useAppNavigation`)
- **AND** the event name MUST be referenced from a shared infrastructure messaging constant (`BROADCAST_EVENTS`)

#### Scenario: Entering a key handling surface

- **GIVEN** the application is running
- **WHEN** the user navigates into the create-key, backup, or unlock surface
- **THEN** the transition MUST go through the centralized navigation hook
- **AND** the hook MUST NOT carry a private key, master password, or backup passphrase in the navigation state

#### Scenario: Leaving a key handling surface tears down key material

- **GIVEN** a key-handling surface holds a revealed key or a password
- **WHEN** the centralized navigation hook moves away from that surface
- **THEN** the teardown for that surface MUST run before the next surface renders
- **AND** the surface's references to key material MUST be dropped

---

### Requirement: Magic String Elimination

System-wide broadcast events MUST be defined as constants in a shared infrastructure messaging file to prevent magic strings. The set of extension documents allowed to hold key material MUST likewise be declared once as shared constants rather than repeated as literals in UI code, navigation logic, or build tooling.

#### Scenario: Using Constants for Events

- **GIVEN** the codebase
- **WHEN** referring to system-wide broadcast events
- **THEN** hardcoded strings MUST NOT be used
- **AND** constants from `src/infrastructure/messaging/events.ts` MUST be used instead

#### Scenario: Using constants for key handling documents

- **GIVEN** the codebase
- **WHEN** referring to the documents allowed to hold key material
- **THEN** hardcoded document names or paths MUST NOT be used
- **AND** the shared key-handling document constants MUST be used instead
- **AND** the build guard that inspects those documents MUST read the same constants

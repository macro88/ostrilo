# UI Architecture Specification

## Purpose

Define shared UI architecture patterns for extension navigation and runtime broadcast events.

## Requirements

### Requirement: Centralized Navigation Logic

The application MUST use a centralized hook for handling navigation state and listening to navigation-related broadcast events.

#### Scenario: Switching to Activity Tab
- **Given** the application is running
- **When** a navigation event is broadcast, such as `SWITCH_TO_ACTIVITY`
- **Then** the application should handle the state change via a centralized hook (`useAppNavigation`)
- **And** the event name should be referenced from a shared infrastructure messaging constant (`BROADCAST_EVENTS`)

---

### Requirement: Magic String Elimination

System-wide broadcast events MUST be defined as constants in a shared infrastructure messaging file to prevent magic strings.

#### Scenario: Using Constants for Events
- **Given** the codebase
- **When** referring to system-wide broadcast events
- **Then** hardcoded strings should not be used
- **And** constants from `src/infrastructure/messaging/events.ts` should be used instead

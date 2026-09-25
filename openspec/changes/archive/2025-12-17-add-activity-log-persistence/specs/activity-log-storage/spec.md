# Capability: Activity Log Storage

**Status**: ADDED  
**Owner**: Ostrilo Core  
**Last Updated**: 2025-12-10

## Overview

Persistent storage and management of user activity entries tracking Nostr signing operations. Implements a ring buffer with configurable retention (default 50 entries, max 500) to provide audit trail and activity history for users.

---

## ADDED Requirements

### Requirement: Persistent Activity Log Storage

**ID**: ALS-001  
**Priority**: Should  

The system SHALL persist activity log entries in local storage with automatic ring buffer rotation when capacity is reached.

#### Scenario: Record signing approval
**Given** a user approves a signing request from "https://primal.net" for kind 1 event  
**When** the signing operation completes successfully  
**Then** an activity entry is created with decision "allow", origin, kind, timestamp, and content preview  
**And** the entry is persisted to local storage  
**And** the entry includes the key ID used for signing

#### Scenario: Record signing denial
**Given** a user denies a signing request from "https://snort.social" for kind 1 event  
**When** the denial action is processed  
**Then** an activity entry is created with decision "deny", origin, kind, and timestamp  
**And** the entry is persisted to local storage  
**And** no key ID is included in the entry

#### Scenario: Ring buffer rotation
**Given** the activity log contains 50 entries (at max capacity)  
**And** maxEntries is configured to 50  
**When** a new signing operation is recorded  
**Then** the new entry is added at position 0 (newest first)  
**And** the oldest entry (position 49) is removed automatically  
**And** the total count remains at 50 entries

#### Scenario: Configurable retention size
**Given** a user changes maxEntries setting from 50 to 100  
**When** the ActivityLogService receives the update  
**Then** future entries respect the new limit  
**And** existing entries are preserved (no immediate truncation)  
**And** next rotation uses the new limit

---

### Requirement: Activity Log Retrieval

**ID**: ALS-002  
**Priority**: Should  

The system SHALL provide methods to retrieve activity entries with pagination, filtering by origin, and filtering by event kind.

#### Scenario: Retrieve recent entries
**Given** the activity log contains 25 entries  
**When** client requests recent entries with limit=10  
**Then** the 10 most recent entries are returned  
**And** entries are ordered by timestamp descending (newest first)

#### Scenario: Paginated retrieval
**Given** the activity log contains 50 entries  
**When** client requests entries with limit=10, offset=20  
**Then** entries 21-30 are returned  
**And** entries are ordered by timestamp descending

#### Scenario: Filter by origin
**Given** the activity log contains entries from "https://primal.net" and "https://snort.social"  
**When** client requests entries filtered by origin "https://primal.net"  
**Then** only entries matching "https://primal.net" are returned  
**And** entries from other origins are excluded

#### Scenario: Filter by event kind
**Given** the activity log contains kind 1 (notes) and kind 7 (reactions) entries  
**When** client requests entries filtered by kind 1  
**Then** only kind 1 entries are returned  
**And** entries with other kinds are excluded

#### Scenario: Combined filters with pagination
**Given** the activity log contains 100 entries across multiple origins and kinds  
**When** client requests origin="https://primal.net", kind=1, limit=5, offset=0  
**Then** up to 5 entries matching both filters are returned  
**And** entries are ordered by timestamp descending  
**And** pagination offset applies after filtering

---

### Requirement: Activity Log Management

**ID**: ALS-003  
**Priority**: Should  

The system SHALL provide management operations for clearing log and initializing from storage.

#### Scenario: Clear all entries
**Given** the activity log contains 30 entries  
**When** user triggers clear all operation  
**Then** all entries are removed from memory  
**And** storage is cleared  
**And** subsequent retrieval returns empty array

#### Scenario: Initialize from existing storage
**Given** local storage contains activity log with 20 entries from previous session  
**When** ActivityLogService is instantiated  
**Then** all 20 entries are loaded into memory  
**And** entries retain original timestamps and order

#### Scenario: Handle corrupted storage gracefully
**Given** local storage contains malformed activity log data  
**When** ActivityLogService attempts to initialize  
**Then** service initializes with empty log  
**And** corrupted data is overwritten with valid schema  
**And** no errors are thrown

---
### Requirement: Activity Entry Data Model

**ID**: ALS-004  
**Priority**: Must  

Each activity log entry MUST contain all required fields for audit and display purposes.
**Description**: Each activity log entry must contain all required fields for audit and display purposes.

#### Scenario: Entry includes all required fields
**Given** a signing request is completed  
**When** an activity entry is created  
**Then** the entry includes id (UUID)  
**And** the entry includes timestamp (Unix seconds)  
**And** the entry includes origin (full URL)  
**And** the entry includes kind (Nostr event kind number)  
**And** the entry includes decision ("allow" or "deny")

#### Scenario: Entry includes optional fields when applicable
**Given** a signing request is approved  
**When** an activity entry is created  
**Then** the entry includes contentPreview (first 100 chars of event.content)  
**And** the entry includes keyId (ID of key used for signing)

#### Scenario: Content preview is sanitized
**Given** an event content contains "This is a very long note with more than one hundred characters that should be truncated to prevent excessive storage usage"  
**When** an activity entry is created  
**Then** contentPreview is truncated to 100 characters  
**And** contentPreview does not contain newlines or control characters

---

## Data Types

```typescript
export interface ActivityLogEntry {
  /** Unique entry ID (UUID) */
  id: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Origin of the dApp (e.g., "https://primal.net") */
  origin: string;
  /** Nostr event kind number */
  kind: number;
  /** User decision: "allow" | "deny" */
  decision: "allow" | "deny";
  /** Content preview (first 100 chars, sanitized) */
  contentPreview?: string;
  /** Key ID used for signing (if allowed) */
  keyId?: string;
}

export interface ActivityLogStorage {
  __version: "activityLog.v1";
  maxEntries: number;
  entries: ActivityLogEntry[];
}

export interface ActivityFilters {
  origin?: string;
  kind?: number;
  limit?: number;
  offset?: number;
}
```

---

## RPC API

### activity.getRecent

**Request**:
```typescript
{ type: "activity.getRecent"; limit?: number; offset?: number }
```

**Response**:
```typescript
{ ok: true; data: { entries: ActivityLogEntry[]; total: number } }
| { ok: false; error: string; details?: string }
```

**Behavior**:
- Default limit: 10
- Default offset: 0
- Returns entries ordered by timestamp descending

### activity.filterBy

**Request**:
```typescript
{ type: "activity.filterBy"; origin?: string; kind?: number; limit?: number; offset?: number }
```

**Response**:
```typescript
{ ok: true; data: { entries: ActivityLogEntry[]; total: number } }
| { ok: false; error: string; details?: string }
```

**Behavior**:
- Applies filters to in-memory entries
- Then applies pagination (limit/offset)
- Returns matching entries ordered by timestamp descending

### activity.clear

**Request**:
```typescript
{ type: "activity.clear" }
```

**Response**:
```typescript
{ ok: true; data: null }
| { ok: false; error: string; details?: string }
```

**Behavior**:
- Clears all entries from memory and storage
- Irreversible operation

---

## Implementation Notes

- **Storage Key**: `"activityLog"` in `browser.storage.local`
- **Ring Buffer**: FIFO with configurable size (50-500 entries)
- **Write Strategy**: Single atomic write per entry addition
- **Read Strategy**: Load all entries into memory on initialization, filter in-memory
- **Default maxEntries**: 50 (configurable via settings)
- **Storage Size Estimate**: ~2.5KB for 50 entries, ~25KB for 500 entries

---

## Related Capabilities

- **nip07-provider**: Activity entries created from signing operations
- **activity-view-ui**: Consumes entries via RPC for display
- **settings**: Provides maxEntries configuration

---

## Testing Requirements

- Unit tests for ActivityLogService (ring buffer, filtering, pagination)
- Integration tests for RPC handlers
- E2E tests for persistence across sessions
- Storage corruption recovery tests

# Capability: Activity View UI

**Status**: ADDED  
**Owner**: Ostrilo Core  
**Last Updated**: 2025-12-10

## Overview

User interface for displaying activity log entries with filtering, pagination, and real-time updates. Replaces static placeholder data in ActivityView with dynamic content from persistent storage.

---

## ADDED Requirements

### Requirement: Display Activity Entries

**ID**: AVU-001  
**Priority**: Should  

ActivityView MUST display real activity entries from storage with proper formatting and visual hierarchy.

#### Scenario: Display recent entries on load
**Given** the activity log contains 15 entries  
**When** user navigates to Activity tab  
**Then** the 10 most recent entries are displayed  
**And** entries show origin, timestamp, event kind name, and decision status  
**And** entries are ordered newest first

#### Scenario: Format timestamps as relative time
**Given** an activity entry with timestamp 2 hours ago  
**When** the entry is displayed  
**Then** timestamp shows "2 hours ago"  
**And** timestamp updates if view remains open

#### Scenario: Display event kind names
**Given** an activity entry with kind 1  
**When** the entry is displayed  
**Then** the kind name shows "Short Text Note" (not "Kind 1")  
**And** unknown kinds show "Kind {number}"

#### Scenario: Show decision status with visual indicators
**Given** an activity entry with decision "allow"  
**When** the entry is displayed  
**Then** a green badge displays "Approved"  
**And** the entry has success styling

**Given** an activity entry with decision "deny"  
**When** the entry is displayed  
**Then** a red badge displays "Denied"  
**And** the entry has error styling

#### Scenario: Show empty state when no entries exist
**Given** the activity log is empty  
**When** user navigates to Activity tab  
**Then** an empty state message displays "No activity yet"  
**And** helpful text explains "Sign events to see activity here"

---

### Requirement: Origin Filtering

**ID**: AVU-002  
**Priority**: Should  

Users MUST be able to filter activity entries by origin to view activity from specific dApps.

#### Scenario: Display origin filter control
**Given** ActivityView is open  
**When** activity entries are displayed  
**Then** an origin filter dropdown is visible  
**And** the dropdown contains "All Origins" option  
**And** the dropdown contains unique origins from current entries

#### Scenario: Filter by selected origin
**Given** activity log contains entries from "https://primal.net" and "https://snort.social"  
**When** user selects "https://primal.net" from origin filter  
**Then** only entries from "https://primal.net" are displayed  
**And** entries from other origins are hidden  
**And** the filter selection persists while view is open

#### Scenario: Clear origin filter
**Given** origin filter is set to "https://primal.net"  
**When** user selects "All Origins" from dropdown  
**Then** all entries are displayed again  
**And** no filtering is applied

---

### Requirement: Event Kind Filtering

**ID**: AVU-003  
**Priority**: Should  

Users MUST be able to filter activity entries by event kind to view specific types of interactions.

#### Scenario: Display kind filter control
**Given** ActivityView is open  
**When** activity entries are displayed  
**Then** a kind filter dropdown is visible  
**And** the dropdown contains "All Kinds" option  
**And** the dropdown contains common kinds (1, 3, 6, 7, etc.)

#### Scenario: Filter by selected kind
**Given** activity log contains kind 1 (notes) and kind 7 (reactions) entries  
**When** user selects "Short Text Note (1)" from kind filter  
**Then** only kind 1 entries are displayed  
**And** entries with other kinds are hidden

#### Scenario: Combined origin and kind filters
**Given** activity log contains entries from multiple origins and kinds  
**When** user selects origin "https://primal.net" and kind 1  
**Then** only entries matching both filters are displayed  
**And** pagination resets to first page

---

### Requirement: Pagination

**ID**: AVU-004  
**Priority**: Should  

Users MUST be able to load more activity entries when initial page is insufficient.

#### Scenario: Initial page load shows limited entries
**Given** activity log contains 50 entries  
**When** ActivityView loads  
**Then** 10 entries are displayed initially  
**And** a "Load More" button is visible

#### Scenario: Load more entries
**Given** 10 entries are currently displayed  
**And** 40 more entries are available  
**When** user clicks "Load More" button  
**Then** 10 additional entries are appended to the list  
**And** total displayed entries becomes 20  
**And** "Load More" button remains visible

#### Scenario: Hide load more when all entries displayed
**Given** 45 entries are currently displayed  
**And** only 5 more entries are available  
**When** user clicks "Load More" button  
**Then** the remaining 5 entries are appended  
**And** total displayed entries becomes 50  
**And** "Load More" button is hidden

#### Scenario: Pagination with filters
**Given** origin filter is set to "https://primal.net"  
**And** 25 matching entries exist  
**And** 10 are currently displayed  
**When** user clicks "Load More"  
**Then** the next 10 matching entries are loaded  
**And** filtering is maintained

---
### Requirement: Real-time Updates

**ID**: AVU-005  
**Priority**: Could  

ActivityView SHALL refresh when new activity entries are created during the session.
**Description**: ActivityView should refresh when new activity entries are created during the session.

#### Scenario: Auto-refresh after signing
**Given** ActivityView is open  
**When** user approves a signing request from approval prompt  
**Then** the new activity entry appears at the top of the list automatically  
**And** no manual refresh is required

**Note**: This scenario is OPTIONAL for v1. Can be implemented as polling or event-driven in future versions.

---
### Requirement: Loading States

**ID**: AVU-006  
**Priority**: Should  

ActivityView MUST show appropriate loading states during data fetching.
**Description**: ActivityView must show appropriate loading states during data fetching.

#### Scenario: Initial loading skeleton
**Given** ActivityView is opening for the first time  
**When** entries are being fetched from storage  
**Then** a skeleton loader displays with placeholder entries  
**And** skeleton shows expected entry structure

#### Scenario: Load more loading state
**Given** user clicks "Load More" button  
**When** additional entries are being fetched  
**Then** "Load More" button shows loading spinner  
**And** button text changes to "Loading..."  
**And** button is disabled during fetch

---

## MODIFIED Requirements
### Requirement: ActivityView Layout

**ID**: AVU-007 (MODIFIED from existing ActivityView)  
**Priority**: Must  

ActivityView MUST display activity entries in a card-based layout with clear visual hierarchy.

**Changes from Previous**:
- ❌ **REMOVED**: Static hardcoded placeholder entries ("Signed Event", "Permission Request", "Key Generated")
- ✅ **ADDED**: Dynamic entries from `useActivityLog()` hook
- ✅ **ADDED**: Filter controls (origin dropdown, kind dropdown)
- ✅ **ADDED**: Pagination controls ("Load More" button)
- ✅ **ADDED**: Empty state when no entries existbutton)
- ✅ **ADDED**: Empty state when no entries exist

#### Scenario: Card layout structure
**Given** activity entries are displayed  
**When** user views the list  
**Then** each entry is a card with border and padding  
**And** cards have consistent spacing between them  
**And** cards are full-width within the container

#### Scenario: Entry content hierarchy
**Given** an activity entry card is displayed  
**When** user views the card  
**Then** event kind name is primary heading  
**And** origin is displayed as secondary text  
**And** timestamp is displayed as tertiary text  
**And** decision badge is visually prominent on the right side

---

## UI Components

### ActivityView Component

**Props**: None (uses internal state)

**State**:
```typescript
{
  entries: ActivityLogEntry[];
  loading: boolean;
  originFilter: string | undefined;
  kindFilter: number | undefined;
  hasMore: boolean;
  offset: number;
}
```

**Layout**:
```
┌────────────────────────────────────────┐
│ Recent Activity                        │
│ Your transaction history               │
├────────────────────────────────────────┤
│ Filters:                               │
│ [Origin Dropdown ▼] [Kind Dropdown ▼] │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ Short Text Note        ✅ Approved │ │
│ │ https://primal.net                 │ │
│ │ 2 hours ago                        │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ Reaction                  ❌ Denied │ │
│ │ https://snort.social               │ │
│ │ 5 hours ago                        │ │
│ └────────────────────────────────────┘ │
│ ...                                    │
├────────────────────────────────────────┤
│          [Load More ▼]                 │
└────────────────────────────────────────┘
```

### useActivityLog Hook

**Signature**:
```typescript
function useActivityLog(filters?: ActivityFilters): {
  entries: ActivityLogEntry[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  error: Error | null;
}
```

**Behavior**:
- Fetches entries on mount and when filters change
- Manages pagination offset internally
- Provides `loadMore()` for pagination
- Provides `refresh()` for manual refresh

---

## Accessibility Requirements

- **Keyboard Navigation**: All filter dropdowns and buttons must be keyboard accessible
- **Screen Reader**: Entry cards must have proper ARIA labels (e.g., "Approved signing request from primal.net 2 hours ago")
- **Focus Management**: "Load More" button must be focusable and have visible focus indicator
- **Color Contrast**: Decision badges must meet WCAG AA contrast ratios

---

## Performance Requirements

- Initial load must complete in <200ms for 50 entries
- Filter application must be instant (<50ms) for in-memory filtering
- Pagination must load smoothly without UI jank
- Timestamp updates should use efficient scheduling (requestAnimationFrame or 1-minute intervals)

---

## Related Capabilities

- **activity-log-storage**: Data source for entries via RPC
- **nip07-provider**: Creates new entries via signing operations
- **settings**: May provide UI theme and preferences

---

## Testing Requirements

- E2E tests for filter interactions
- E2E tests for pagination behavior
- Visual regression tests for card layout
- Accessibility audit with Playwright a11y checks

# Design: Activity Log Persistence

## Architecture Overview

This change follows the established Hexagonal Architecture pattern with clear separation between domain, application, and infrastructure layers.

```
┌─────────────────────────────────────────────────────────────┐
│                         UI Layer                            │
│  ActivityView → useActivityLog → RPC Client                │
└─────────────────────────┬───────────────────────────────────┘
                          │ (RPC)
┌─────────────────────────▼───────────────────────────────────┐
│                   Infrastructure Layer                      │
│  ActivityRpcHandler → ActivityLogService                    │
│  NostrRpcHandler → ActivityLogService.recordEntry()         │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Application Layer                        │
│  ActivityLogService (ring buffer management)                │
│   ├─ addEntry(entry)                                        │
│   ├─ getRecent(limit, offset)                              │
│   ├─ filterBy(origin?, kind?)                              │
│   └─ clearAll()                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                      Domain Layer                           │
│  ActivityLogEntry type (timestamp, origin, kind, decision)  │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### ActivityLogEntry Type

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
```

### Storage Schema

Stored in `browser.storage.local` under key `"activityLog"`:

```typescript
interface ActivityLogStorage {
  __version: "activityLog.v1";
  maxEntries: number; // User-configurable, default 50
  entries: ActivityLogEntry[]; // Ring buffer, newest first
}
```

## Ring Buffer Implementation

The ActivityLogService maintains a ring buffer with configurable size:

1. **Add Entry**: New entries inserted at position 0 (newest first)
2. **Rotation**: When buffer exceeds `maxEntries`, oldest entries removed
3. **Atomic Writes**: Single storage write per entry to prevent corruption
4. **Read Operations**: Filter and pagination happen in-memory for performance

### Trade-offs

**Chosen Approach: Ring Buffer in Application Service**
- ✅ Simple implementation using array operations
- ✅ Configurable size (50-500 entries)
- ✅ Automatic rotation, no manual cleanup needed
- ✅ Fast read operations (in-memory filtering)
- ⚠️ Limited history retention (acceptable for audit use case)

**Alternative Considered: IndexedDB with Unlimited History**
- ❌ More complex implementation
- ❌ Harder to test and maintain
- ❌ Overkill for typical usage (50 entries = ~1 week of activity)
- ✅ Would support unlimited history and advanced queries

**Decision**: Ring buffer is sufficient for v1. Can migrate to IndexedDB later if users request longer history.

## Integration Points

### 1. Logging Hook in NostrRpcHandler

After every `nostr.signEvent` resolution (success or denial), record an entry:

```typescript
// In nostr-rpc.ts handleSignEvent()
const decision = action === "allow" || action === "allow_once" ? "allow" : "deny";
await context.activityLog.addEntry({
  origin: message.origin,
  kind: message.event.kind,
  decision,
  contentPreview: message.event.content.substring(0, 100),
  keyId: decision === "allow" ? selectedKeyId : undefined,
});
```

### 2. RPC Methods

New `activity.*` namespace:

```typescript
| { type: "activity.getRecent"; limit?: number; offset?: number }
| { type: "activity.filterBy"; origin?: string; kind?: number; limit?: number; offset?: number }
| { type: "activity.clear" }
```

### 3. UI Component Updates

**ActivityView.tsx**:
- Replace hardcoded items with `useActivityLog()` hook
- Add filter controls (origin dropdown, kind selector)
- Add pagination (Show More / Load More pattern)
- Display real timestamps, event kinds, and decisions

**New Hook: useActivityLog.ts**:
```typescript
export function useActivityLog(filters?: ActivityFilters) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    rpc.activityGetRecent({ ...filters }).then(/* ... */);
  }, [filters]);
  
  return { entries, loading, refresh };
}
```

## Performance Considerations

- **Storage Size**: 50 entries × ~50 bytes = ~2.5KB (negligible)
- **Read Latency**: Single storage.get() + in-memory filtering = ~5ms
- **Write Latency**: Single storage.set() per sign operation = ~10ms (non-blocking)
- **Memory Footprint**: ~2.5KB in RAM for cached entries

## Testing Strategy

### Unit Tests (Application Layer)
- `ActivityLogService.test.ts`:
  - ✓ Add entry to empty log
  - ✓ Ring buffer rotation when maxEntries exceeded
  - ✓ Filter by origin returns correct subset
  - ✓ Filter by kind returns correct subset
  - ✓ Pagination with limit/offset
  - ✓ Clear all entries

### Integration Tests
- `activity-log-integration.test.ts`:
  - ✓ Sign approval creates activity entry
  - ✓ Sign denial creates activity entry
  - ✓ Multiple sign operations maintain correct order

### E2E Tests
- `activity-view.spec.ts`:
  - ✓ ActivityView displays recent sign events
  - ✓ Filter by origin shows only matching entries
  - ✓ Filter by kind shows only matching entries
  - ✓ Pagination loads more entries

## Migration Path

### v1 (This Change)
- Ring buffer with 50 entries default
- Origin and kind filters
- Basic pagination

### Future Enhancements (Out of Scope)
- Export activity log as CSV/JSON
- Full-text search of event content
- Date range filtering
- Chart/visualization of activity patterns
- Migrate to IndexedDB for unlimited history

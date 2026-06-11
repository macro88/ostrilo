# Design: Approval Queue UX Improvements

## Context

The current approval flow creates a new popup window for every signing request that requires user approval. This design was simple to implement but creates poor UX when:
1. **High-frequency dApps** like Primal or Snort send multiple events in rapid succession (e.g., auto-refresh, multiple subscriptions)
2. **Retry behavior** where dApps re-send the same event if they don't receive a timely response, creating duplicate approval prompts
3. **User workflow** where closing the approval window causes subsequent requests to open new windows repeatedly
4. **Limited event visibility** where users only see truncated content preview, not complete event details needed for informed signing decisions

Key stakeholders:
- **End users** experiencing approval fatigue, window management issues, and lack of event detail transparency
- **dApp developers** wanting reliable signing without overwhelming users
- **Extension maintainers** needing testable, debuggable approval flow
- **Security-conscious users** requiring complete event information before signing

Constraints:
- Must maintain existing RPC API compatibility (no breaking changes for dApps)
- Must preserve FIFO queue ordering for fairness
- Must show complete event details (content, tags, metadata) per security best practices
- Must follow Ostrilo's hexagonal architecture (Domain → Application → Infrastructure → UI layers)
- Must handle edge cases: window closed by user, extension updated mid-approval, timeout behavior
- Must work across Chrome MV3 and Firefox MV2 with different window APIs

## Goals / Non-Goals

**Goals:**
- Reduce approval window spam to single managed window instance
- De-duplicate identical events (by NIP-01 event ID hash) to prevent retry-induced duplicates
- Provide queue list overview so users understand pending workload (inbox-style)
- Display complete event details when signing (full content, complete tags, all metadata)
- Enable batch operations for efficient processing of multiple requests from same origin
- Make pending queue accessible even when approval window is closed (via Activity page)
- Maintain all existing security guarantees (timeout, origin display, etc.)
- Follow hexagonal architecture: UI layer components in `src/ui/features/approval/`, no domain logic in UI

**Non-Goals:**
- Automatic approval of any events (all security policies remain unchanged)
- Queue persistence across extension restarts (acceptable to clear on restart/update)
- Priority queue or reordering (maintain FIFO for simplicity)
- Cross-tab communication for approval window (single window sufficient)

## Decisions

### Decision 1: Event ID hash-based de-duplication

**What:** Track pending requests by computed NIP-01 event ID hash in addition to UUID. When duplicate event hash detected, return the existing Promise instead of creating new queue entry.

**Why:** 
- Event ID uniquely identifies event content per NIP-01 spec (hash of [0, pubkey, created_at, kind, tags, content])
- dApps often retry with identical event if no response received
- Prevents user from seeing duplicate approvals for same logical operation
- Same Promise fulfillment ensures both callers get identical signed event

**Alternatives considered:**
1. **Time-based de-duplication window (30s)** - Rejected because arbitrary time window creates edge cases and doesn't solve fundamental retry problem
2. **UUID-only tracking** - Current approach, doesn't catch duplicates at all
3. **Content-based fuzzy matching** - Overly complex, event ID is canonical identifier

**Trade-offs:**
- ✅ Solves retry spam elegantly
- ✅ Works across origins (same event from different origins = same approval)
- ⚠️ Requires computing event ID before approval (minor perf cost ~2ms)
- ⚠️ Adds complexity to queue service (two data structures to maintain)

### Decision 2: Single window with focus management

**What:** Track approval window ID in background script module scope. Check if window exists before creating new one; focus existing window instead. Close window automatically when queue empties. The managed approval window uses a 960×640 target size so the inbox list and detail pane can be visible together on desktop.

**Why:**
- Prevents window spam and overlapping popups
- Centralizes approval UI state in one location
- Aligns with user expectation (one approval = one window)
- Enables queue list view (show all pending in single scrollable list)

**Alternatives considered:**
1. **Tab-based approval in sidepanel** - Rejected because sidepanel not available in Firefox MV2, less discoverable than popup
2. **Multiple windows with deduplication** - Doesn't solve core UX problem, adds complexity
3. **Badge-only notification** - Too subtle, users may miss approval requests

**Trade-offs:**
- ✅ Clean UX with single window
- ✅ Easy to test (deterministic window state)
- ⚠️ Requires tracking window lifecycle (onRemoved event listener)
- ⚠️ Must handle user closing window gracefully (queue remains accessible via Activity page)
- ⚠️ Must guard concurrent `focusOrCreateApprovalWindow()` calls so simultaneous signing requests cannot race before `approvalWindowId` is assigned

### Decision 3: Queue list with detail view (two-panel UX)

**What:** Replace single-request display with a two-part interface: (1) scrollable queue list showing all pending requests grouped by origin (inbox-style), and (2) detailed event view when user selects a request to sign (email-style). The detail view shows complete event information including full content, complete tags array, created_at, kind, and signing key.

**Why:**
- Queue list provides overview of all pending work (transparency)
- Origin grouping makes batch actions natural
- Detail view ensures users see complete event information before signing (security requirement)
- Separates browsing queue from signing decision (similar to email: inbox → open message → reply)
- Per-request timers maintain fairness in both list and detail views

**Alternatives considered:**
1. **Single-panel with expanded items** - Rejected because expanding multiple items creates long scrollable list, harder to navigate
2. **Modal overlay for details** - Considered, but two-panel split or navigation approach is cleaner
3. **Paginated carousel** - Rejected because hides queue depth and full event details
4. **Inline expansion in list** - Rejected because full event details (tags, content) need more space than inline allows

**Trade-offs:**
- ✅ Transparent queue state with full event visibility
- ✅ Clear separation between queue management and signing decision
- ✅ Scales to dozens of pending requests
- ✅ Users can review full event details (tags, content, metadata) before signing
- ⚠️ More complex UI component (list + detail view coordination)
- ⚠️ Requires state management for selected request
- ⚠️ Mobile/small screen may need responsive layout (stack vertically)

### Decision 4: Activity page queue access

**What:** Add "Pending Approvals" section to Activity tab showing pending count and "Open Approval Window" button.

**Why:**
- Users who close approval window need way to access pending requests
- Avoids forced popup reopening (user controls when to deal with queue)
- Leverages existing Activity tab for approval-related actions
- Provides secondary entry point for queue management

**Alternatives considered:**
1. **Auto-reopen window on close** - Rejected because too aggressive, ignores user intent
2. **Badge-only indicator** - Too passive, users may not understand how to access queue
3. **Dedicated queue page** - Overkill, Activity tab already approval-related

**Trade-offs:**
- ✅ Respects user agency (close window when busy)
- ✅ Reuses existing UI surface (Activity tab)
- ⚠️ Requires updating ActivityView component
- ⚠️ Users must know to check Activity tab (discoverability via pending count badge)

## Architecture Changes

### Queue Service Data Structures

**Before:**
```typescript
private queue: PendingRequest[] = [];
private timedOut = new Set<string>();
```

**After:**
```typescript
private queue: PendingRequest[] = []; // UUID-based FIFO queue
private eventIdMap = new Map<string, PendingRequest>(); // Event hash → request
private timedOut = new Set<string>();
```

**Enqueue logic:**
```typescript
enqueue(event: UnsignedEvent, origin: string, eventIdHash?: string): PendingRequest {
  // Check for duplicate by event hash
  if (eventIdHash && this.eventIdMap.has(eventIdHash)) {
    return this.eventIdMap.get(eventIdHash)!; // Reuse existing Promise
  }
  
  // Create new request
  const request = { id: uuid(), event, origin, promise: new Promise(...), ... };
  this.queue.push(request);
  
  if (eventIdHash) {
    this.eventIdMap.set(eventIdHash, request);
  }
  
  return request;
}
```

### Background Script Window Management

**New state:**
```typescript
let approvalWindowId: number | null = null;
let approvalWindowOperation: Promise<number | undefined> | null = null;

// In src/extension/background.ts
browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
  }
});
```

**Window creation flow:**
```typescript
// In src/extension/background.ts
async function focusOrCreateApprovalWindow(): Promise<number | undefined> {
  if (approvalWindowOperation) {
    return approvalWindowOperation;
  }

  if (approvalWindowId !== null) {
    try {
      await browser.windows.update(approvalWindowId, { focused: true });
      return approvalWindowId;
    } catch {
      approvalWindowId = null; // Window was closed
    }
  }

  const window = await browser.windows.create({ url: "/approval.html", ... });
  approvalWindowId = window.id!;
  return approvalWindowId;
}
```

### RPC Message Flow

**New RPC method:**
```typescript
// ApprovalRpcHandler
"approval.getAll": async () => {
  const allPending = this.approvalQueue.getAllPending(); // New method
  return allPending.map(req => ({
    id: req.id,
    origin: req.origin,
    event: req.event,
    remainingTime: req.timeoutAt - Date.now(),
    eventIdHash: req.eventIdHash, // Optional diagnostic field
  }));
}
```

**Queue update notifications:**
```typescript
// In NostrRpcHandler after enqueue
await focusOrCreateApprovalWindow();
browser.runtime.sendMessage({ type: "queue.updated", count: approvalQueue.getPendingCount() });
```

## Risks / Trade-offs

### Risk: Window tracking state desync
**Scenario:** Extension updated while approval window open, `approvalWindowId` resets to null but window still exists.

**Mitigation:** On background script startup, query all extension windows and close any stray approval windows. Add window type metadata if needed. Current implementation also serializes concurrent focus/create attempts with an in-flight operation promise so simultaneous requests reuse one window.

### Risk: Event ID collision (SHA-256 birthday paradox)
**Scenario:** Two genuinely different events hash to same ID (astronomically unlikely but theoretically possible).

**Mitigation:** Accept risk as negligible (2^-128 probability for practical scenarios). Event ID is canonical per NIP-01, collision would break protocol anyway.

### Risk: Memory growth with large queue
**Scenario:** Malicious dApp sends thousands of unique signing requests to DoS queue.

**Mitigation:** Implement queue size limit (e.g., 100 pending requests max). Reject new requests with error "queue_full" once limit reached. Monitor queue size in background script.

### Risk: UI complexity affecting maintainability
**Scenario:** Queue list view with grouping, batch actions, and timers becomes hard to test and debug.

**Mitigation:** 
- Break UI into composable subcomponents (QueueGroup, QueueItem, BatchActions)
- Write unit tests for grouping logic separately from React components
- Add E2E tests covering batch operations and edge cases
- Use React DevTools and structured logging for debugging

## Migration Plan

### Phase 1: Backend (De-duplication & Window Management)
1. Update `ApprovalQueueService` with event ID map and `enqueue()` changes
2. Write unit tests for de-duplication behavior
3. Update `background.ts` with window tracking state and `focusOrCreateApprovalWindow()`
4. Update `NostrRpcHandler.requestApproval()` to compute event ID and use new window logic
5. **Validation:** Existing E2E tests still pass (backward compatible)

### Phase 2: UI Transformation
6. Create `QueueListView` component with origin grouping (inbox-style list)
7. Create `EventDetailView` component with full event information display
8. Implement batch action handlers
9. Add `approval.getAll` RPC method to `ApprovalRpcHandler`
10. Update `ApprovalPrompt.tsx` to coordinate queue list and detail view navigation
11. Add JSON formatting for tags display in detail view
12. **Validation:** Manual testing with real dApp (Primal) to verify queue list and detail view UX

### Phase 3: Activity Page Integration
13. Update `ActivityView.tsx` with "Pending Approvals" section
14. Implement "Open Approval Window" button logic
15. **Validation:** E2E test covering queue access from Activity page

### Phase 4: Testing & Polish
16. Add comprehensive E2E tests (de-duplication, batch actions, window focus, detail view navigation, etc.)
17. Run full test suite (unit + integration + E2E)
18. Build for Chrome and Firefox, smoke test with multiple dApps
19. **Validation:** All tests pass, no console errors, smooth UX with full event details visible

### Rollback Plan
If critical issue discovered post-deployment:
- Revert `ApprovalPrompt.tsx`, `QueueListView.tsx`, `EventDetailView.tsx` to single-request view (UI-only rollback)
- Keep de-duplication logic (low risk, high value)
- Keep window management improvements (low risk, high value)
- Most rollback risk is in UI complexity (two-panel navigation), which can be reverted independently

## Open Questions

1. **Queue size limit:** What's appropriate max queue size? 50? 100? 500?
   - **Recommendation:** Start with 100, monitor telemetry after deployment
   
2. **Batch action default:** Should "Approve All from Origin" create "allow" policy or use "allow_once"?
   - **Recommendation:** Use "allow_once" by default, add checkbox to "Remember for this site" if user wants policy change
   
3. **Queue sorting:** Should high-priority event kinds (e.g., kind 1 text notes) be surfaced differently than low-priority (e.g., kind 10000 mute lists)?
   - **Recommendation:** Defer to future iteration, maintain FIFO for MVP
   
4. **Cross-origin de-duplication UX:** If same event queued from origin-a and origin-b, which origin is shown in approval UI?
   - **Recommendation:** Show first origin that requested, add note "Also requested by 1 other site" if applicable

5. **Window positioning:** Should approval window remember last position/size?
   - **Recommendation:** Defer to future iteration, use default centering for MVP

6. **Event template rendering:** Should we add kind-specific templates for better event visualization (e.g., kind:1 notes formatted differently than kind:10000 mute lists)?
   - **Recommendation:** Defer to future iteration. For MVP, display formatted JSON for all event types. This provides complete transparency and works for all kinds. Future enhancement can add custom renderers per kind.

7. **Tags array formatting:** Should tags be displayed as raw JSON or parsed into structured table?
   - **Recommendation:** Use formatted JSON with syntax highlighting for MVP (simple, transparent, works for all tag types). Future enhancement can add smart tag parser that shows special tags (e, p, a) in human-readable format.

8. **Navigation between detail views:** Should "Next" button allow jumping between detail views without returning to list?
   - **Recommendation:** Add optional "Next Request" button in detail view for quick sequential processing. Batch actions still available by returning to list view.

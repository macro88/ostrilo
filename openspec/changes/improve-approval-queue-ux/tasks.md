# Implementation Tasks: Improve Approval Queue UX

## Phase 1: Event De-duplication in Queue Service

- [ ] **1.1** Add event ID hash tracking to `ApprovalQueueService`
  - Import `computeEventId` from `@/domain/crypto/event-id`
  - Add private `eventIdMap: Map<string, PendingRequest>` field to track by event hash
  - **Validation:** Type check passes, class compiles

- [ ] **1.2** Update `enqueue()` method to accept and check event ID hash
  - Add optional `eventIdHash?: string` parameter
  - Before creating new PendingRequest, check if `eventIdHash` exists in `eventIdMap`
  - If duplicate detected, return existing `PendingRequest.promise` from map
  - If new, add to both `queue` and `eventIdMap` (if hash provided)
  - **Validation:** Unit test verifies duplicate hash returns same Promise instance

- [ ] **1.3** Update `resolve()` method to clean up event ID mapping
  - After removing from `queue`, also remove from `eventIdMap` using stored hash
  - **Validation:** Unit test confirms both structures updated on resolve

- [ ] **1.4** Update `timeout()` method to clean up event ID mapping
  - Move timed-out request from `eventIdMap` to avoid blocking future duplicates
  - **Validation:** Unit test confirms timeout clears both queue and map

- [ ] **1.5** Add `getQueuedEventIds()` method for diagnostics
  - Return array of currently queued event ID hashes
  - **Validation:** Unit test verifies accurate list of pending event IDs

- [ ] **1.6** Write comprehensive unit tests for de-duplication logic
  - Test: Duplicate event ID returns same Promise
  - Test: Different event IDs create separate queue entries
  - Test: Resolution of one duplicate doesn't affect others (if different UUIDs somehow)
  - Test: Timeout clears event ID mapping
  - Test: Same event from different origins shares queue entry
  - **Validation:** All tests pass, coverage >90% for updated methods

## Phase 2: Single Window Management in Background Script

- [ ] **2.1** Add window tracking state to `background.ts`
  - Declare `let approvalWindowId: number | null = null` in module scope
  - Add helper function `async focusOrCreateApprovalWindow()`
  - Add listener for `browser.windows.onRemoved` to clear `approvalWindowId`
  - **Validation:** Type check passes, background script compiles

- [ ] **2.2** Implement `focusOrCreateApprovalWindow()` logic
  - If `approvalWindowId !== null`, attempt to focus using `browser.windows.update(id, { focused: true })`
  - Catch error if window doesn't exist (user closed), clear `approvalWindowId`
  - If window doesn't exist, create new window with `browser.windows.create()` and store ID
  - Return window ID for badge updates
  - **Validation:** Manual test confirms window reuse behavior

- [ ] **2.3** Update `NostrRpcHandler.requestApproval()` to use new window management
  - Replace direct `browser.windows.create()` call with `focusOrCreateApprovalWindow()`
  - Pass window ID to badge update logic
  - **Validation:** Integration test verifies single window reused

- [ ] **2.4** Add auto-close logic when queue empties
  - In `ApprovalRpcHandler.resolve()`, after resolving request, check pending count
  - If `pendingCount === 0` and `approvalWindowId !== null`, close window with `browser.windows.remove()`
  - Clear `approvalWindowId` state
  - **Validation:** E2E test confirms window closes after last approval

- [ ] **2.5** Update badge count on window focus
  - When focusing existing window, update badge to reflect current queue count
  - **Validation:** Manual test confirms badge accuracy

## Phase 3: Compute Event ID Before Enqueueing

- [ ] **3.1** Update `NostrRpcHandler` to compute event ID early
  - Locate handler in `src/infrastructure/messaging/handlers/nostr-rpc.ts`
  - After policy evaluation (around line ~200), call `computeEventId(event, selectedKey.publicKeyHex)`
  - Store result in `const eventIdHash = computeEventId(...)`
  - Pass `eventIdHash` to `approvalQueue.enqueue()` as new parameter
  - **Validation:** Unit test verifies event ID computed before queue

- [ ] **3.2** Handle duplicate detection gracefully
  - If `enqueue()` returns existing Promise (duplicate detected), log info message
  - Return the reused Promise to dApp without creating new popup
  - **Validation:** E2E test confirms duplicate requests don't open new window

- [ ] **3.3** Update approval queue type signature
  - Modify `PendingRequest` interface to include optional `eventIdHash?: string` field
  - Update `enqueue()` method signature in service interface
  - **Validation:** Type check passes across all usages

## Phase 4: Transform Approval UI to Queue List with Detail View

- [ ] **4.1** Create `QueueListView` component
  - Create `src/ui/features/approval/components/QueueListView.tsx`
  - Accept props: `requests: PendingRequest[]`, `onSelectRequest: (id: string) => void`, `onBatchAction: (action, requestIds) => void`
  - Render scrollable list with origin grouping
  - Each origin group collapsible with request count badge
  - Each request item shows: origin favicon, kind badge, timestamp, truncated content (max 50 chars)
  - **Validation:** Component renders with mock data

- [ ] **4.2** Create `EventDetailView` component
  - Create `src/ui/features/approval/components/EventDetailView.tsx`
  - Accept props: `request: PendingRequest`, `signingKey: KeyRecord`, `countdown: number`, `onResolve: (action) => void`, `onBack: () => void`
  - Display origin (envelope header style with favicon)
  - Display event kind number and human-readable name
  - Display created_at timestamp in readable format (e.g., "Dec 18, 2025 at 3:45 PM")
  - Display complete event content in scrollable preformatted block (not truncated)
  - Display complete tags array in formatted JSON view (use `<pre>` with syntax highlighting)
  - Display signing key (pubkey) with copy button
  - Show countdown timer
  - Show action buttons: Allow Once, Allow for Site, Deny Once, Deny + Remember
  - Include back button to return to queue list
  - **Validation:** Component renders full event details correctly

- [ ] **4.3** Implement origin grouping logic in QueueListView
  - Group pending requests by origin domain
  - Sort groups alphabetically or by most recent request
  - Render collapsible sections per origin with request count badge
  - Show individual requests within each group
  - **Validation:** UI test confirms correct grouping

- [ ] **4.4** Add batch action buttons to QueueListView
  - At origin group level: "Approve All" button (approves all from that origin)
  - At top level: "Deny All" button (denies all pending requests)
  - Implement batch resolution logic calling `onBatchAction` callback
  - Show confirmation dialog for batch operations
  - **Validation:** E2E test confirms batch actions resolve multiple requests

- [ ] **4.5** Update `ApprovalPrompt.tsx` to coordinate queue list and detail view
  - Replace single-request display with state-driven router
  - Add state: `selectedRequestId: string | null`
  - When `selectedRequestId` is null, show `QueueListView` with all pending requests
  - When `selectedRequestId` is set, show `EventDetailView` for that specific request
  - Fetch all pending requests via new RPC method `approval.getAll` on mount
  - Handle `onSelectRequest` to set selected ID and switch to detail view
  - Handle `onBack` from detail view to return to queue list
  - Handle `onResolve` to process action and refresh queue
  - **Validation:** E2E test confirms navigation between list and detail views

- [ ] **4.6** Add RPC method `approval.getAll` to `ApprovalRpcHandler`
  - Locate handler in `src/infrastructure/messaging/handlers/approval-rpc.ts`
  - Return array of all pending requests with metadata (id, origin, event, timeout, eventIdHash)
  - **Validation:** Unit test verifies correct data structure returned

- [ ] **4.7** Implement real-time queue updates
  - Add message listener in `ApprovalPrompt` for queue change events
  - Background sends `queue.updated` message when new request added or resolved
  - Refresh queue list on message receipt
  - Update selected request if still pending, otherwise return to list view
  - **Validation:** E2E test confirms UI updates without manual refresh

- [ ] **4.8** Add JSON syntax highlighting for tags display
  - Install or use lightweight JSON formatter for tags array
  - Display tags in `EventDetailView` with proper indentation and syntax colors
  - Make JSON scrollable if tags array is large
  - **Validation:** Manual test with event containing complex tags array

## Phase 5: Activity Page Queue Access

- [ ] **5.1** Add "Pending Approvals" section to Activity view
  - Update `src/ui/features/activity/ActivityView.tsx` to show pending count badge
  - Add expandable section showing simplified list of pending requests (origin + kind only)
  - Link to "Open Approval Window" button
  - **Validation:** UI test confirms section appears when queue not empty

- [ ] **5.2** Implement "Open Approval Window" action
  - Button triggers RPC to background to focus/create approval window
  - Use existing `focusOrCreateApprovalWindow()` logic
  - **Validation:** Manual test confirms button opens/focuses window

## Phase 6: Testing and Validation

- [ ] **6.1** Write E2E test for concurrent requests
  - Simulate 5 sign requests from same origin sent simultaneously
  - Verify single approval window opens
  - Verify all 5 requests appear in queue list
  - Verify FIFO processing order
  - **Validation:** Test passes consistently

- [ ] **6.2** Write E2E test for duplicate event de-duplication
  - Send same unsigned event twice (identical content, kind, tags, created_at)
  - Verify only one approval entry appears
  - Verify both Promise callers receive same result after approval
  - **Validation:** Test passes, proves de-duplication works

- [ ] **6.3** Write E2E test for window focus behavior
  - Open approval window with pending request
  - Send new sign request
  - Verify existing window gains focus instead of new window opening
  - Verify badge count updates to reflect queue size
  - **Validation:** Test passes

- [ ] **6.4** Write E2E test for batch actions
  - Queue 3 requests from "origin-a" and 2 from "origin-b"
  - Use "Approve All from origin-a" button
  - Verify 3 requests resolved with "allow_once" action
  - Verify origin-b requests still pending
  - **Validation:** Test passes

- [ ] **6.5** Write E2E test for window auto-close
  - Queue 2 requests
  - Approve both via queue list
  - Verify window automatically closes after second approval
  - **Validation:** Test passes

- [ ] **6.6** Write E2E test for Activity page queue access
  - Queue request but close approval window
  - Open main popup and navigate to Activity tab
  - Verify "Pending Approvals" section visible
  - Click "Open Approval Window" and verify window opens with queue
  - **Validation:** Test passes

- [ ] **6.7** Update existing E2E tests for behavioral changes
  - Update `approval-flow.spec.ts` to account for queue list + detail view navigation
  - Test: Select request from list → see full event details → approve → return to list
  - Test: Queue list displays truncated content, detail view shows full content
  - Ensure no regressions in basic approve/deny flows
  - **Validation:** All existing tests pass

- [ ] **6.8** Write E2E test for full event detail display
  - Queue request with complex event (long content, multiple tags)
  - Navigate from queue list to detail view
  - Verify complete content displayed (not truncated)
  - Verify complete tags array displayed in formatted JSON
  - Verify created_at timestamp formatted correctly
  - Verify all metadata visible (origin, kind, signing key)
  - **Validation:** Test passes

## Phase 7: Documentation and Cleanup

- [ ] **7.1** Update activity log documentation
  - Document new queue access feature in Activity view
  - Update screenshots if applicable
  - **Validation:** Docs reviewed

- [ ] **7.2** Add JSDoc comments to new methods
  - Document `focusOrCreateApprovalWindow()` behavior
  - Document event ID de-duplication logic in queue service
  - **Validation:** Code review confirms clarity

- [ ] **7.3** Run full test suite
  - Execute `npm run test` (unit + integration)
  - Execute `npm run test:e2e` (Playwright)
  - Verify no regressions
  - **Validation:** All tests pass, coverage maintained

- [ ] **7.4** Build and manual smoke testing
  - Run `npm run build` and `npm run build:firefox`
  - Load extension in both browsers
  - Test approval flow with real dApp (e.g., Primal, Snort)
  - Verify queue list UI, de-duplication, and window management
  - **Validation:** No console errors, UX smooth

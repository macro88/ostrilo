# Tasks: Add Activity Log Persistence

## Implementation Checklist

### Phase 1: Domain & Types
- [ ] Add `ActivityLogEntry` interface to `src/domain/types.ts`
- [ ] Add `ActivityLogStorage` interface to `src/domain/types.ts`
- [ ] Add `ActivityFilters` type for filtering parameters
- [ ] Add helper function `getKindName()` usage for activity display

### Phase 2: Application Service
- [ ] Create `src/application/services/activity-log.service.ts`
- [ ] Implement `ActivityLogService` class with ring buffer logic
- [ ] Implement `addEntry(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>)` method
- [ ] Implement `getRecent(limit?: number, offset?: number)` method
- [ ] Implement `filterBy(filters: ActivityFilters)` method
- [ ] Implement `clearAll()` method
- [ ] Implement `setMaxEntries(max: number)` method for settings integration
- [ ] Initialize service with storage loading in constructor

### Phase 3: Infrastructure - RPC Layer
- [ ] Add `activity.*` request types to `src/infrastructure/messaging/rpc.ts`
- [ ] Add `ActivityGetRecentResponse`, `ActivityFilterResponse` types
- [ ] Create `src/infrastructure/messaging/handlers/activity-rpc.ts`
- [ ] Implement `ActivityRpcHandler` class
- [ ] Implement `handleRequest()` router for activity namespace
- [ ] Implement `handleGetRecent()` method
- [ ] Implement `handleFilterBy()` method
- [ ] Implement `handleClear()` method
- [ ] Add Zod schemas for activity request validation in `validation/schemas.ts`

### Phase 4: Background Integration
- [ ] Instantiate `ActivityLogService` in `src/extension/background.ts`
- [ ] Pass `ActivityLogService` in `ServiceContext` to RPC handlers
- [ ] Register `ActivityRpcHandler` with router as `"activity"` module
- [ ] Integrate activity logging in `NostrRpcHandler.handleSignEvent()`
- [ ] Record entry after approval resolution with decision and event details

### Phase 5: RPC Client
- [ ] Add `activityGetRecent()` function to `src/infrastructure/messaging/client.ts`
- [ ] Add `activityFilterBy()` function to RPC client
- [ ] Add `activityClear()` function to RPC client
- [ ] Type all client functions with correct response types

### Phase 6: UI Layer - Hook
- [ ] Create `src/ui/features/activity/hooks/useActivityLog.ts`
- [ ] Implement `useActivityLog(filters?: ActivityFilters)` hook
- [ ] Handle loading state and error states
- [ ] Implement pagination state (offset tracking)
- [ ] Implement `loadMore()` function for pagination
- [ ] Implement `refresh()` function to reload entries

### Phase 7: UI Layer - Components
- [ ] Update `src/ui/features/activity/components/ActivityView.tsx`
- [ ] Replace static data with `useActivityLog()` hook
- [ ] Add filter controls (origin selector, kind selector)
- [ ] Implement origin filter dropdown with unique origins from entries
- [ ] Implement kind filter dropdown with common kinds
- [ ] Add "Clear Filters" button
- [ ] Add pagination UI (Show More / Load More button)
- [ ] Display real entry data: timestamp, origin, kind name, decision status
- [ ] Format timestamps with relative time (e.g., "2 hours ago")
- [ ] Show event kind names using `getKindName()` helper
- [ ] Style decision badges (green for allow, red for deny)
- [ ] Add empty state when no entries exist
- [ ] Add loading skeleton during initial fetch

### Phase 8: Settings Integration (Optional)
- [ ] Add `maxActivityEntries` to `AppSettingsV1` schema
- [ ] Add settings control in SettingsView for max entries
- [ ] Update `ActivityLogService` when settings change
- [ ] Add "Clear Activity Log" button in settings with confirmation

### Phase 9: Testing - Unit Tests
- [ ] Create `tests/unit/application/activity-log.service.test.ts`
- [ ] Test: Add entry to empty log
- [ ] Test: Ring buffer rotation when maxEntries exceeded
- [ ] Test: Filter by origin returns correct subset
- [ ] Test: Filter by kind returns correct subset
- [ ] Test: Pagination with limit/offset works correctly
- [ ] Test: Clear all entries empties log
- [ ] Test: Service initializes from existing storage
- [ ] Create `tests/unit/infrastructure/activity-rpc.test.ts`
- [ ] Test: RPC handler routes all activity.* methods
- [ ] Test: Validation rejects invalid requests

### Phase 10: Testing - Integration Tests
- [ ] Create `tests/integration/activity-log-integration.test.ts`
- [ ] Test: Sign approval creates activity entry in storage
- [ ] Test: Sign denial creates activity entry in storage
- [ ] Test: Multiple sign operations maintain correct order (newest first)
- [ ] Test: Ring buffer rotation works end-to-end

### Phase 11: Testing - E2E Tests
- [ ] Create `tests/e2e/activity-view.spec.ts`
- [ ] Test: ActivityView displays recent sign events after signing
- [ ] Test: Filter by origin shows only matching entries
- [ ] Test: Filter by kind shows only matching entries
- [ ] Test: Pagination loads more entries when clicking Load More
- [ ] Test: Empty state displays when no activity exists
- [ ] Test: Activity persists across popup close/reopen

### Phase 12: Documentation
- [ ] Update `.github/copilot-instructions.md` with ActivityLogService reference
- [ ] Update `docs/architecture_primer.md` with activity log architecture
- [ ] Add JSDoc comments to all public methods in ActivityLogService
- [ ] Document storage schema in `docs/` if needed

## Validation Criteria

Each task should be considered complete when:
1. Code compiles without TypeScript errors (`npm run compile`)
2. Related unit tests pass (if applicable)
3. Code follows existing patterns (RPC, services, Hexagonal Architecture)
4. JSDoc comments added to public APIs
5. No breaking changes to existing functionality

## Dependencies Between Tasks

- **Phase 1** must complete before Phase 2
- **Phase 2** must complete before Phase 3, 4
- **Phase 3** must complete before Phase 5
- **Phase 4** must complete before integration testing
- **Phase 5** must complete before Phase 6
- **Phase 6** must complete before Phase 7
- **Phases 1-7** must complete before Phase 9-11 testing
- **Testing phases can run in parallel** once implementation complete

## Estimated Effort

- **Phase 1-5**: Core implementation (~2-3 hours)
- **Phase 6-7**: UI implementation (~2-3 hours)
- **Phase 8**: Settings integration (~1 hour, optional)
- **Phase 9-11**: Testing (~3-4 hours)
- **Phase 12**: Documentation (~1 hour)

**Total**: ~9-12 hours of focused development work

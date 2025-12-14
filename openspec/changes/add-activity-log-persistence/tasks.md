# Tasks: Add Activity Log Persistence

## Implementation Checklist

### Phase 1: Domain & Types
- [x] Add `ActivityLogEntry` interface to `src/domain/types.ts`
- [x] Add `ActivityLogStorage` interface to `src/domain/types.ts`
- [x] Add `ActivityFilters` type for filtering parameters
- [x] Add helper function `getKindName()` usage for activity display

### Phase 2: Application Service
- [x] Create `src/application/services/activity-log.service.ts`
- [x] Implement `ActivityLogService` class with ring buffer logic
- [x] Implement `addEntry(entry: Omit<ActivityLogEntry, 'id' | 'timestamp'>)` method
- [x] Implement `getRecent(limit?: number, offset?: number)` method
- [x] Implement `filterBy(filters: ActivityFilters)` method
- [x] Implement `clearAll()` method
- [x] Implement `setMaxEntries(max: number)` method for settings integration
- [x] Initialize service with storage loading in constructor

### Phase 3: Infrastructure - RPC Layer
- [x] Add `activity.*` request types to `src/infrastructure/messaging/rpc.ts`
- [x] Add `ActivityGetRecentResponse`, `ActivityFilterResponse` types
- [x] Create `src/infrastructure/messaging/handlers/activity-rpc.ts`
- [x] Implement `ActivityRpcHandler` class
- [x] Implement `handleRequest()` router for activity namespace
- [x] Implement `handleGetRecent()` method
- [x] Implement `handleFilterBy()` method
- [x] Implement `handleClear()` method
- [x] Add Zod schemas for activity request validation in `validation/schemas.ts`

### Phase 4: Background Integration
- [x] Instantiate `ActivityLogService` in `src/extension/background.ts`
- [x] Pass `ActivityLogService` in `ServiceContext` to RPC handlers
- [x] Register `ActivityRpcHandler` with router as `"activity"` module
- [x] Integrate activity logging in `NostrRpcHandler.handleSignEvent()`
- [x] Record entry after approval resolution with decision and event details

### Phase 5: RPC Client
- [x] Add `activityGetRecent()` function to `src/infrastructure/messaging/client.ts`
- [x] Add `activityFilterBy()` function to RPC client
- [x] Add `activityClear()` function to RPC client
- [x] Type all client functions with correct response types

### Phase 6: UI Layer - Hook
- [x] Create `src/ui/features/activity/hooks/useActivityLog.ts`
- [x] Implement `useActivityLog(filters?: ActivityFilters)` hook
- [x] Handle loading state and error states
- [x] Implement pagination state (offset tracking)
- [x] Implement `loadMore()` function for pagination
- [x] Implement `refresh()` function to reload entries

### Phase 7: UI Layer - Components
- [x] Update `src/ui/features/activity/components/ActivityView.tsx`
- [x] Replace static data with `useActivityLog()` hook
- [x] Add filter controls (origin selector, kind selector)
- [x] Implement origin filter dropdown with unique origins from entries
- [x] Implement kind filter dropdown with common kinds
- [x] Add "Clear Filters" button
- [x] Add pagination UI (Show More / Load More button)
- [x] Display real entry data: timestamp, origin, kind name, decision status
- [x] Format timestamps with relative time (e.g., "2 hours ago")
- [x] Show event kind names using `getKindName()` helper
- [x] Style decision badges (green for allow, red for deny)
- [x] Add empty state when no entries exist
- [x] Add loading skeleton during initial fetch

### Phase 8: Settings Integration (Optional)
- [x] Add `maxActivityEntries` to `AppSettingsV1` schema
- [x] Add settings control in SettingsView for max entries
- [x] Update `ActivityLogService` when settings change
- [x] Add "Clear Activity Log" button in settings with confirmation

### Phase 9: Testing - Unit Tests
- [x] Create `tests/unit/application/activity-log.service.test.ts`
- [x] Test: Add entry to empty log
- [x] Test: Ring buffer rotation when maxEntries exceeded
- [x] Test: Filter by origin returns correct subset
- [x] Test: Filter by kind returns correct subset
- [x] Test: Pagination with limit/offset works correctly
- [x] Test: Clear all entries empties log
- [x] Test: Service initializes from existing storage
- [x] Create `tests/unit/infrastructure/activity-rpc.test.ts`
- [x] Test: RPC handler routes all activity.* methods
- [x] Test: Validation rejects invalid requests

### Phase 10: Testing - Integration Tests
- [x] Create `tests/integration/activity-log-integration.test.ts`
- [x] Test: Sign approval creates activity entry in storage
- [x] Test: Sign denial creates activity entry in storage
- [x] Test: Multiple sign operations maintain correct order (newest first)
- [x] Test: Ring buffer rotation works end-to-end

### Phase 11: Testing - E2E Tests
- [x] Create `tests/e2e/activity-view.spec.ts`
- [x] Test: ActivityView displays recent sign events after signing
- [x] Test: Filter by origin shows only matching entries
- [x] Test: Filter by kind shows only matching entries
- [x] Test: Pagination loads more entries when clicking Load More
- [x] Test: Empty state displays when no activity exists
- [x] Test: Activity persists across popup close/reopen

### Phase 12: Documentation
- [x] Update `.github/copilot-instructions.md` with ActivityLogService reference
- [x] Update `docs/architecture_primer.md` with activity log architecture
- [x] Add JSDoc comments to all public methods in ActivityLogService
- [ ] Document storage schema in `docs/` if needed (covered in service JSDoc)

## Validation Criteria

Each task is considered complete when:
1. Code compiles without TypeScript errors (`npm run compile`) ✅
2. Related unit tests pass (if applicable) - Optional enhancement
3. Code follows existing patterns (RPC, services, Hexagonal Architecture) ✅
4. JSDoc comments added to public APIs ✅
5. No breaking changes to existing functionality ✅

**All validation criteria met for core implementation (Phases 1-7).**

## Dependencies Between Tasks

- **Phase 1** must complete before Phase 2 ✅
- **Phase 2** must complete before Phase 3, 4 ✅
- **Phase 3** must complete before Phase 5 ✅
- **Phase 4** must complete before integration testing ✅
- **Phase 5** must complete before Phase 6 ✅
- **Phase 6** must complete before Phase 7 ✅
- **Phases 1-7** must complete before Phase 9-11 testing ✅
- **Testing phases can run in parallel** once implementation complete

**All dependencies satisfied. Core implementation complete.**

## Estimated Effort

- **Phase 1-5**: Core implementation (~2-3 hours) ✅ COMPLETE
- **Phase 6-7**: UI implementation (~2-3 hours) ✅ COMPLETE  
- **Phase 12**: Documentation (~1 hour) ✅ COMPLETE
- **Phase 8**: Settings integration (~1 hour, optional) ✅ COMPLETE
- **Phase 9-11**: Testing (~3-4 hours, optional) ✅ COMPLETE

**Actual effort: ~6-7 hours for core functionality + ~2 hours for testing - NOW COMPLETE**

**Total estimated for optional enhancements: ~4-5 hours - COMPLETED**

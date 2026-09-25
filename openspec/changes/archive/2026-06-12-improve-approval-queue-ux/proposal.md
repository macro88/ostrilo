# Change: Improve Approval Queue UX with De-duplication and Single Window

## 2026-06-11 Review Status

Status: Implemented and archive-ready.

This change has already landed on `main` through the approval queue UX work. The task list is fully checked, and the current code includes the managed approval window, queue list/detail layout, event de-duplication, batch actions, Activity page queue access, and Playwright coverage in `tests/e2e/approval-queue-ux.spec.ts`.

Development readiness: no new development should start from this proposal. The next OpenSpec action is archive/sync so the `nip07-provider` baseline spec reflects the implemented behavior.

## Why

The current implementation creates a new popup window for each signing request, causing poor UX when dApps send multiple or duplicate events. When sites like Primal request several events simultaneously or retry the same event, users face:
- Multiple overlapping popup windows creating visual clutter
- Duplicate approval requests for identical events (same event ID)
- Errors when signing earlier duplicate popups because a later popup already signed the event
- No visibility into the pending queue or ability to batch-process requests

## What Changes

- **Event de-duplication by event ID hash** - Queue service tracks pending events by computed event ID; duplicate requests from same or different origins reuse the same pending Promise
- **Single managed approval window** - Background script tracks approval window lifecycle; focuses existing window instead of creating duplicates; serializes concurrent open attempts; closes window when queue empties
- **Queue list view UI** - Approval interface shows all pending requests in scrollable list grouped by origin; users can see full queue and perform batch actions
- **Desktop approval inbox sizing** - Approval window uses a wider inbox/detail layout so the queue list and selected event content are visible together instead of forcing a cramped single-column prompt
- **Batch approval actions** - UI provides "Approve All from Origin" and "Deny All" buttons to process multiple requests efficiently
- **Improved queue visibility** - Queue accessible from Activity page in main popup for users who close approval window

## Impact

### Affected Specs
- `nip07-provider` - Modified approval prompt and queue requirements

### Affected Code
- `src/application/services/approval-queue.service.ts` - Add event ID de-duplication tracking
- `src/extension/background.ts` - Add window lifecycle management
- `src/infrastructure/messaging/handlers/nostr-rpc.ts` - Compute event ID before enqueueing (NostrRpcHandler)
- `src/ui/features/approval/components/ApprovalPrompt.tsx` - Transform to queue list with detail view
- `src/ui/features/approval/components/` - Add QueueListView and EventDetailView components
- `tests/e2e/approval-flow.spec.ts` - Add de-duplication and batch action tests

### User Experience Improvements
- Single approval window remains focused when new requests arrive
- Simultaneous signing requests cannot race into multiple approval windows
- Duplicate events (retries) don't create additional approval burden
- Queue visibility helps users understand pending workload (list view like email inbox)
- Full event details displayed when signing (detailed view like opening an email)
- Users see complete event information: origin, kind, created_at, full content, complete tags array, signing key
- Batch actions enable efficient processing of multiple requests from same origin
- Closing approval window doesn't lose pending requests (accessible via Activity page)

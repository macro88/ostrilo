# Change: Add Activity Log Persistence

## Why

ActivityView currently displays static placeholder data with hardcoded "Signed Event", "Permission Request", and "Key Generated" entries. Users cannot see their actual signing history, which prevents them from:
- Auditing which dApps they've interacted with and when
- Reviewing what events they've signed or denied
- Troubleshooting permission issues by viewing past decisions
- Understanding their Nostr activity patterns

The PRD requirement NS-F-008 specifies persistent activity logging, and NS-U-003 requires connecting ActivityView to real storage. This change delivers on both requirements by implementing a ring buffer storage for activity entries and connecting the UI to display, filter, and paginate real data.

## What Changes

- **ActivityLogService**: New application service managing a ring buffer of activity entries (default 50, configurable up to 500)
- **Activity storage**: Persistent log entries in local storage with automatic rotation
- **ActivityLogEntry type**: Domain type capturing timestamp, origin, event kind, decision, and event content preview
- **Activity RPC module**: New `activity.*` namespace with `activity.list`, `activity.getRecent` methods
- **ActivityView enhancements**: Replace static data with real entries, add origin/kind filters, pagination controls
- **Logging integration**: Hook into NostrRpcHandler to record every sign approval/denial

## Impact

- **New capability**: `activity-log-storage` - Persistent activity logging with ring buffer
- **New capability**: `activity-view-ui` - Enhanced ActivityView with real data and filters
- **Affected code**:
  - `src/domain/types.ts` - Add `ActivityLogEntry` type
  - `src/application/services/activity-log.service.ts` - New service
  - `src/infrastructure/messaging/handlers/activity-rpc.ts` - New RPC handler
  - `src/infrastructure/messaging/rpc.ts` - Add `activity.*` request types
  - `src/infrastructure/messaging/handlers/nostr-rpc.ts` - Integrate logging on sign completion
  - `src/extension/background.ts` - Instantiate ActivityLogService and register handler
  - `src/ui/features/activity/components/ActivityView.tsx` - Connect to RPC, add filters/pagination
  - `src/ui/features/activity/hooks/useActivityLog.ts` - New hook for fetching activity data
- **Storage impact**: ~5-25KB for 50-500 entries (50 bytes average per entry)
- **No breaking changes**: Additive only, existing functionality unaffected

## Security Considerations

- Activity log stored in local storage (not synced across devices for privacy)
- Event content preview limited to first 100 characters to avoid storing sensitive data
- No private keys or decrypted content stored
- Origin verification from content script, not user-modifiable
- Log entries include only what user already approved/denied (no additional exposure)

## Dependencies

- **Depends on**: `add-approval-prompt` (ApprovalQueueService pattern, PendingRequest type)
- **Depends on**: `add-nip07-provider` (NostrRpcHandler integration point)

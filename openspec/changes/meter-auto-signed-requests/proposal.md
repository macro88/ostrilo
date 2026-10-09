## Why

A remembered allow rule, or a `high` trust level, makes a site's requests sign without a prompt. That is the point of the feature and it is also an uncapped signing oracle. The approval flood controls bound how often an origin may *enqueue* an approval, and a request that policy auto-signs never enters the queue, so no limit applied to it at all. A compromised or hostile page on a trusted origin could obtain thousands of signatures a minute and the user would see none of it. The spec said so on purpose ("Auto-signed requests are unaffected"); the owner has now decided it should not stay that way (2026-10-09).

The flood controls also lived in worker memory. MV3 ends an idle service worker, and a page that waited out the eviction got every allowance back. The unlock keepalive (`keep-unlocked-session-alive`) makes eviction rare while the vault is unlocked, but it does not run while locked, and the `getPublicKey` limit applies while locked. That limit is the one most exposed.

## What Changes

- **An auto-sign budget.** A request that site policy would sign without a prompt is counted against its origin: 60 per rolling 60 seconds. Within the budget it signs as before. Over it, the request is **routed to the approval window exactly as an `ask` decision is**: same queue, same window, same limits. It is never refused for exceeding the budget. If the queue then refuses it (per-origin enqueue rate, 5 pending, 20 global), the page gets the queue's existing `rate_limited` error; that is the queue's limit, not the budget's.
- **The approval window says why.** A prompt raised because the budget was spent carries a short line saying the site went over its automatic-signing limit, so a site shown as Trusted that suddenly needs approval does not read as a fault.
- **Counters persist.** The approval queue's per-origin enqueue window, the `getPublicKey` disclosure window and the new auto-sign window are written to `storage.session`, so an evicted worker does not reset them. Each is a bounded, validated record with its own key; a record that cannot be read as a valid window is an empty window, never a missing limit. The queue's pending caps count live entries and cannot outlive the worker, so they have no record.
- **A request the background can no longer answer fails canonically.** When the worker ends while a request is open, the content script reports `approval_failed` to the page instead of the browser's own wording for a closed message port. The page is never left to hang: the provider's 65 second backstop still applies as a last resort. Locking already denies every pending approval and is unchanged.

Not changed: the policy decision itself (`allow`, `ask`, `deny`); protected kinds, which always prompt and are not counted; the existing 10 per minute, 5 pending and 20 global queue limits and the 6 per minute `getPublicKey` limit; and the vault, which still fails closed when the worker dies.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `approval-flood-controls`: the "auto-signed requests are unaffected" scenario is replaced; adds the auto-sign budget and persistence of the counters.
- `site-signing-policies`: a remembered allow auto-signs within the origin's budget.
- `identity-disclosure-consent`: the public-key rate window survives a worker restart.
- `nip07-provider`: a request the background cannot answer fails with `approval_failed`.

## Impact

**Code**
- `src/application/services/rolling-window-counters.ts` (new): the bounded, validated, persisted per-origin window shared by all three limiters.
- `src/application/services/auto-sign-budget.service.ts` (new).
- `src/application/services/approval-queue.service.ts`, `disclosure-rate-limit.service.ts`: counters move onto the shared window; `ready()` and `settled()`.
- `src/infrastructure/messaging/handlers/nostr-rpc.ts`: the budget in the branch where policy decides to sign, after key resolution; handlers await the persisted window before enforcing.
- `src/infrastructure/messaging/rpc-router.ts`: `ServiceContext.autoSignBudget`, required.
- `src/extension/background.ts`: wires `storage.session` into the three limiters.
- `src/extension/content.ts`: `approval_failed` when the background does not answer.
- `src/domain/types.ts`: `PendingRequest.exceededAutoSignBudget`, display-only.
- `src/ui/features/approval/components/EventDetailView.tsx`: the notice.

**Storage:** three new `storage.session` keys (`rateWindow:approvalEnqueue`, `rateWindow:disclosure`, `rateWindow:autoSign`). Nothing sensitive: an origin and millisecond timestamps. The lock-state record is not touched. **Manifest:** no new permission.

**Behaviour users will notice:** a site that signs more than 60 requests in a minute without prompting (a client reacting to a fast scroll, a bulk import) is asked from the 61st on, and the prompts stop once the minute rolls over. Nothing else changes for a site inside its budget.

**Not in scope:** making the limits configurable (SEC-006's remaining item); a per-kind budget; persisting pending approvals themselves, which are tied to the page's open message port and cannot be resumed.

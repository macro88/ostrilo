## Prerequisites

- [ ] 0.1 `add-nip07-provider` proposal must be implemented and merged

## 1. Domain Types

- [ ] 1.1 Add `PendingRequest` type to `src/domain/types.ts` (id, origin, event, createdAt, timeoutAt)
- [ ] 1.2 Add `ApprovalDecision` type: `"allow" | "deny"`
- [ ] 1.3 Add `ApprovalAction` type: `"allow" | "allow_once" | "deny" | "deny_remember"`

## 2. Pending Request Queue

- [ ] 2.1 Create `src/application/services/approval-queue.service.ts`
- [ ] 2.2 Implement `enqueue(origin, event)` returning Promise that resolves on decision
- [ ] 2.3 Implement `getNextPending()` returning oldest pending request
- [ ] 2.4 Implement `resolve(requestId, decision)` to complete pending request
- [ ] 2.5 Implement timeout handling (60s) with auto-deny
- [ ] 2.6 Add unit tests for queue operations and timeout behavior

## 3. RPC Endpoints

- [ ] 3.1 Add `approval.getNext` RPC type to fetch next pending request
- [ ] 3.2 Add `approval.resolve` RPC type with requestId and action
- [ ] 3.3 Add `approval.count` RPC type returning pending count
- [ ] 3.4 Create `src/infrastructure/messaging/handlers/approval-rpc.ts`
- [ ] 3.5 Register `approval` module in background.ts RpcRouter
- [ ] 3.6 Add unit tests for approval RPC handlers

## 4. Integrate with NIP-07 Handler

- [ ] 4.1 Modify `nostr-rpc.ts` handleSignEvent to call approval queue when policy is `ask`
- [ ] 4.2 Open approval popup via `browser.windows.create` when request is queued
- [ ] 4.3 Return signed event or error based on queue resolution
- [ ] 4.4 Handle popup creation failure gracefully

## 5. Approval Popup Entrypoint

- [ ] 5.1 Create `src/extension/approval/index.html` with React mount point
- [ ] 5.2 Create `src/extension/approval/main.tsx` as React entry
- [ ] 5.3 Register approval popup in `wxt.config.ts` as additional entrypoint
- [ ] 5.4 Configure popup window dimensions (400x500 recommended)

## 6. Approval Prompt UI

- [ ] 6.1 Create `src/ui/features/approval/components/ApprovalPrompt.tsx`
- [ ] 6.2 Display origin with favicon and domain name
- [ ] 6.3 Display event kind with human-readable name (use ALL_EVENT_KINDS mapping)
- [ ] 6.4 Display content preview (truncated to 200 chars)
- [ ] 6.5 Display which key will be used for signing (pubkey truncated)
- [ ] 6.6 Show countdown timer for timeout
- [ ] 6.7 Implement action buttons: Allow, Allow Once, Deny, Deny + Remember
- [ ] 6.8 Show pending request count if queue has multiple items
- [ ] 6.9 Style consistent with existing Ostrilo UI (Tailwind + shadcn)

## 7. Policy Update on "Remember"

- [ ] 7.1 When user clicks "Deny + Remember", call `policy.setKindRule(origin, kind, "deny")`
- [ ] 7.2 Verify rule persists and affects future evaluations
- [ ] 7.3 Add unit test for policy update on deny remember

## 8. Cross-Browser Support

- [ ] 8.1 Test popup creation on Chrome MV3
- [ ] 8.2 Test popup creation on Firefox MV2
- [ ] 8.3 Handle browser.windows.create differences between browsers
- [ ] 8.4 Fallback to extension badge notification if popup fails

## 9. Integration & Testing

- [ ] 9.1 Add unit tests for ApprovalQueueService (enqueue, resolve, timeout)
- [ ] 9.2 Add unit tests for approval RPC handlers
- [ ] 9.3 Add E2E test: signEvent with `ask` policy → popup appears
- [ ] 9.4 Add E2E test: click Allow → event signed and returned
- [ ] 9.5 Add E2E test: click Deny → error returned to dApp
- [ ] 9.6 Add E2E test: click Deny + Remember → deny rule created
- [ ] 9.7 Add E2E test: timeout → auto-deny with timeout error
- [ ] 9.8 Manual test with Nostr web client requiring approval

## 10. Documentation

- [ ] 10.1 Update `docs/developers_readme.md` with approval flow documentation
- [ ] 10.2 Add user-facing help text in approval prompt explaining each action

## Dependencies

- Task 0.1 (prerequisite) must complete before starting
- Tasks 1.x must complete before 2.x (types needed for service)
- Tasks 2.x and 3.x can run in parallel
- Tasks 4.x depend on 2.x and 3.x
- Tasks 5.x and 6.x can run in parallel
- Tasks 7.x depend on 6.x
- Tasks 8.x depend on 5.x
- Tasks 9.x depend on all implementation tasks

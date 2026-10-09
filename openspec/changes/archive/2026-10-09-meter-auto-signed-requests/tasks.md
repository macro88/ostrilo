## 1. Counters

- [x] 1.1 `RollingWindowCounters`: per-origin rolling window with an optional `StoragePort`, `ready()` and `settled()`, a per-origin cap, an origin cap, validation on read and coalesced write-through
- [x] 1.2 Unit tests on a fake clock: window edge, per-origin scope, persistence and original-schedule roll-off, expiry while away, a charge during the read is merged, coalesced writes, failed read and failed write, malformed records (wrong shape, unknown version, bad timestamps, oversized list, oversized key, future timestamps), the origin cap
- [x] 1.3 Move the approval queue's enqueue window and the disclosure window onto it; `ready()` and `settled()` on both

## 2. Budget

- [x] 2.1 `AutoSignBudgetService`: 60 per origin per rolling 60 seconds, refusal charges nothing
- [x] 2.2 `ServiceContext.autoSignBudget`, required; wired with `storage.session` in `background.ts`
- [x] 2.3 `handleSignEvent`: charge in the branch where policy decides to sign, after key resolution; over budget takes the `ask` path; handlers await the persisted windows before enforcing
- [x] 2.4 Unit tests: 60th allowed and 61st refused, refusals charge nothing, roll-off, restart persistence, malformed record
- [x] 2.5 Integration tests with the real policy, queue and handler: 61st is queued flagged and signs on approval, denial is `denied`, the queue's own `rate_limited` when its pending cap is hit, per-origin scope, roll-off, an unreadable key does not spend the budget, a restart does not reset the budget or the enqueue window

## 3. The approval window

- [x] 3.1 `PendingRequest.exceededAutoSignBudget`, set by the queue from an enqueue option
- [x] 3.2 The notice in the signing prompt, using the existing amber panel
- [x] 3.3 Component tests: shown when flagged, absent otherwise, approving unchanged
- [x] 3.4 Light and dark review on the production build, recorded in `docs/design-review/README.md`

## 4. A worker that ends mid-request

- [x] 4.1 Measure what the page sees today with `ServiceWorker.stopWorker` (a prompt rejection carrying the browser's own wording, not a hang)
- [x] 4.2 `content.ts` answers `approval_failed`
- [x] 4.3 Chrome e2e: the page gets `approval_failed` promptly, and a retry reports `locked`; confirmed failing before the content-script change
- [x] 4.4 Chrome e2e for the budget: 60 silent signatures through a real page, then the approval window with the notice

## 5. Docs and verify

- [x] 5.1 `docs/roadmap.md` (SEC-006, SEC-024, PERF-008 and their known issues), `docs/rpc-error-codes.md`
- [x] 5.2 Archive this change (Task 14 of phase 0.10)

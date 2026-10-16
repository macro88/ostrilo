## Context

`QUEUE_LIMITS` and `DISCLOSURE_RATE_LIMITS` bound how often an origin may raise a prompt or sample the public key. Neither covers a request that policy answers `allow`, and both kept their windows in worker memory.

## Decisions

### 1. Over budget means ask, not refuse

A refusal would turn a busy but legitimate client into an outage, and a client cannot tell "this site is over a budget the user never configured" from a fault. Asking turns a flood into a prompt the user can decline, and the queue's own limits already bound how many prompts a flood can raise. The owner's decision (SEC-006) is the same: a site with a remembered allow rule that exceeds its budget falls back to the approval window; it is not refused.

The over-budget request takes the same enqueue path an `ask` decision takes. When the queue is full the page receives `rate_limited` with the queue's wording. That is the queue's limit speaking, and the budget itself never produces an error.

### 2. Where the budget is charged

In `handleSignEvent`, after the lock check and after `resolveSigningKey`, in the branch where policy has decided to sign without a prompt (`mode === "allow"` and the kind is not protected). A request refused for an unreadable key is therefore never charged, and a protected kind, which prompts regardless, is not counted. A refused over-budget request is not charged either, so a flood does not extend its own window.

Per origin and per rolling 60 seconds, 60 requests: one a second sustained is already well beyond a person reacting and reading.

### 3. One persisted window, three limiters

The three limiters share `RollingWindowCounters`, constructed with a `StoragePort`, a storage key, a window length and a per-origin cap equal to the limit. Each limiter has its own key, so one cannot spend another's allowance, and none touches the `lockState` record.

- **`storage.session`, not `local`.** It outlives the worker and dies with the browser session, so a counter never outlasts what it meters, and it is never synced or written to disk.
- **Validated on read.** The record is `{ v: 1, origins: { [origin]: number[] } }`. A wrong shape, an unknown version, a non-finite timestamp, a list longer than the limiter could have written or an origin key longer than a URL can be is dropped. Timestamps from the future are clamped to now; expired ones are dropped. **A record that cannot be read as a valid window is an empty window.** The record is written only by this class, so a malformed one means damage or a format change, not an attacker's choice. Empty is the documented fallback and still leaves the limit in force from that point.
- **Bounded.** At most 256 origins, and `maxPerOrigin` timestamps each. Keeping only the newest `limit` timestamps per origin is exact for a rolling window. Past the origin cap the origin with the oldest activity is dropped, so cycling subdomains cannot grow the record without bound; the price is that a dropped origin starts a fresh window, which costs an attacker 256 distinct origins per reset.
- **Read before enforcing.** A request that wakes a restarted worker awaits `ready()` first. Loading *merges* into memory rather than assigning, so a charge made during the read is never lost to it.
- **Write-through, coalesced.** Every charge marks the window dirty; one write is in flight at a time and each carries the state as of when it is written. A failed write is logged and the in-memory window keeps enforcing; only restart survival is lost.

### 4. What is not persisted

The approval queue's pending entries and its pending caps. An entry holds the resolver of a page's open message port, and that port dies with the worker, so a persisted entry could never be answered. Locking already denies every pending entry; a worker that ends while a request is open leaves the page with an unanswered message, which is the next decision.

### 5. A request the background cannot answer

What a page saw when the worker ended mid-approval was measured in Chrome with `ServiceWorker.stopWorker`: the content script's `sendMessage` rejects promptly, so the page does not hang, but the rejection carried the browser's own text ("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received") through to a web page. That string is internal, unstable and not canonical. The content script now sends `approval_failed` for any failed relay. No new code is added: the request could not be completed, which is what `approval_failed` already says for the queue, and a retry reports `locked` because the restarted worker holds no keys.

## Risks

- A burst of more than 60 legitimate silent signatures a minute now prompts. Accepted: the prompt is the safe failure, and the budget is the owner's decision.
- A write to `storage.session` per charge. Session storage is in memory and the writes are coalesced.

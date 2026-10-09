import type { StoragePort } from "@/application/ports/storage";
import { RollingWindowCounters } from "./rolling-window-counters";
import {
  ApprovalDecision,
  ApprovalAction,
  PendingRequest,
  UnsignedEvent,
} from "@/domain/types";

/** Default timeout for approval requests (60 seconds) */
/**
 * How long a request waits for the user, in ms.
 *
 * Exported because the injected provider needs the SAME number. The page
 * side hard-coded 30 seconds while this side ran for 60, so a user who
 * approved at 45 seconds produced a real signature over a real event that
 * the page had already rejected and thrown away. The signature existed;
 * nobody received it.
 */
export const APPROVAL_TIMEOUT_MS = 60_000;

/**
 * Extra time the page-side backstop waits beyond the extension deadline.
 *
 * The extension-side deadline is authoritative. This one only exists so a
 * page is not left with a promise that never settles if the extension goes
 * away mid-request, and it must fire strictly later than the real one.
 */
export const PROVIDER_TIMEOUT_GRACE_MS = 5_000;

/**
 * Flood controls.
 *
 * There were none. A page could enqueue approval prompts as fast as it
 * could call `signEvent`, and each one opened or refreshed an approval
 * window. That is denial of service against the user's own browser, and it
 * is also the setup for approval fatigue: the reliable way to get a
 * signature the user did not mean to give is to ask a hundred times.
 *
 * Per-origin, because one hostile site must not be able to exhaust the
 * queue and lock out a legitimate one.
 */
export const QUEUE_LIMITS = {
  /** New entries one origin may enqueue per rolling window. */
  perOriginPerWindow: 10,
  windowMs: 60_000,
  /** Entries one origin may have waiting at once. */
  perOriginPending: 5,
  /** Entries any number of origins may have waiting at once. */
  globalPending: 20,
} as const;

/** Thrown by enqueue when an origin is over a limit. */
export class ApprovalRateLimitError extends Error {
  constructor(public readonly reason: "rate" | "origin_full" | "queue_full") {
    super(reason);
    this.name = "ApprovalRateLimitError";
  }
}

/** Distinct from every other counter's record. */
export const ENQUEUE_WINDOW_STORAGE_KEY = "rateWindow:approvalEnqueue";

const DEFAULT_TIMEOUT_MS = APPROVAL_TIMEOUT_MS;

/** Callback type for when a request is resolved or times out */
export type RequestResolver = (
  decision: ApprovalDecision,
  action: ApprovalAction
) => void;

/** Callback type for when queue changes (enqueue, resolve, timeout) */
export type QueueChangeCallback = () => void;

/** Internal request entry with resolver callback */
interface QueueEntry {
  request: PendingRequest;
  resolvers: RequestResolver[];
  timeoutId: ReturnType<typeof setTimeout>;
  eventIdHash?: string; // Optional event ID hash for de-duplication
  dedupeKey?: string; // Composite (origin, eventIdHash) de-duplication key
}

/**
 * Build the de-duplication key.
 *
 * The key includes the origin because an approval prompt is a statement about
 * one site. De-duplicating on the event id alone means a click the user
 * believed applied to site A also returns a signature to site B, which can
 * predict or replay a byte-identical event. Origin attribution is the whole
 * point of a consent prompt.
 *
 * The separator is a NUL, which cannot appear in an origin, so no pair of
 * (origin, hash) values can collide by concatenation.
 */
function makeDedupeKey(origin: string, eventIdHash: string): string {
  return `${origin}\u0000${eventIdHash}`;
}

/**
 * ApprovalQueueService manages pending approval requests
 *
 * When policy evaluates to "ask", requests are queued here and await
 * user decision via the approval popup. The service handles:
 * - Enqueueing new requests with unique IDs
 * - Returning the next pending request (FIFO order)
 * - Resolving requests with user decisions
 * - Auto-denying requests after timeout (60s)
 */
export class ApprovalQueueService {
  private queue: Map<string, QueueEntry> = new Map();
  private eventIdMap: Map<string, QueueEntry> = new Map(); // Track by (origin, event ID hash) for de-duplication
  private timeoutMs: number;
  private timedOutRequests: Set<string> = new Set(); // Track which requests timed out
  private changeCallback?: QueueChangeCallback; // Optional callback for queue changes

  /**
   * @param storage - Where the per-origin enqueue window persists, so a worker
   *   restart does not hand every origin a fresh allowance. The pending caps
   *   count live entries, which cannot outlive the worker, so they need no
   *   record.
   */
  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS, storage?: StoragePort) {
    this.timeoutMs = timeoutMs;
    this.enqueueWindows = new RollingWindowCounters({
      storage,
      storageKey: ENQUEUE_WINDOW_STORAGE_KEY,
      windowMs: QUEUE_LIMITS.windowMs,
      maxPerOrigin: QUEUE_LIMITS.perOriginPerWindow,
    });
  }

  /**
   * Resolves once the persisted enqueue window has been read. Await before
   * `enqueue`, so a request that wakes a restarted worker is judged against the
   * window the worker had when it died.
   */
  ready(): Promise<void> {
    return this.enqueueWindows.ready();
  }

  /** Resolves when every enqueue charged so far has been written. */
  settled(): Promise<void> {
    return this.enqueueWindows.settled();
  }

  /**
   * Set callback to be invoked when queue changes (enqueue, resolve, timeout)
   * @param callback - Function to call when queue state changes
   */
  setChangeCallback(callback: QueueChangeCallback): void {
    this.changeCallback = callback;
  }

  /**
   * Notify listeners that queue has changed
   */
  private notifyChange(): void {
    if (this.changeCallback) {
      this.changeCallback();
    }
  }

  /** Enqueue timestamps per origin, trimmed to the rolling window. */
  private readonly enqueueWindows: RollingWindowCounters;

  /** Number of entries this origin currently has waiting. */
  private pendingForOrigin(origin: string): number {
    let count = 0;
    for (const entry of this.queue.values()) {
      if (entry.request.origin === origin) count++;
    }
    return count;
  }

  /** Throws ApprovalRateLimitError when this origin may not enqueue. */
  private assertCapacity(origin: string): void {
    if (this.queue.size >= QUEUE_LIMITS.globalPending) {
      throw new ApprovalRateLimitError("queue_full");
    }
    if (this.pendingForOrigin(origin) >= QUEUE_LIMITS.perOriginPending) {
      throw new ApprovalRateLimitError("origin_full");
    }

    if (
      this.enqueueWindows.count(origin) >= QUEUE_LIMITS.perOriginPerWindow
    ) {
      throw new ApprovalRateLimitError("rate");
    }
  }

  /** Charges one enqueue against this origin's rolling allowance. */
  private recordEnqueue(origin: string): void {
    this.enqueueWindows.record(origin);
  }

  /**
   * Resolve a request the PAGE abandoned, always as a denial.
   *
   * The page-side deadline used to fire at 30 seconds while this queue ran
   * for 60, so a user approving at 45 seconds produced a real signature that
   * the page had already discarded. The deadlines are aligned now, and this
   * is the backstop: when the page gives up, the prompt goes away too.
   *
   * It can only ever DENY. There is deliberately no approving counterpart -
   * a page-reachable path that resolves an approval as allowed would be a
   * way to sign without asking anyone.
   *
   * The origin is supplied by the content script, not the page, so one site
   * cannot cancel another's prompt.
   */
  cancelByClientRequestId(origin: string, clientRequestId: string): boolean {
    for (const entry of this.queue.values()) {
      if (
        entry.request.origin === origin &&
        entry.request.clientRequestId === clientRequestId
      ) {
        return this.resolve(entry.request.id, "deny");
      }
    }
    return false;
  }

  /**
   * Enqueue a new approval request with automatic de-duplication.
   *
   * If an eventIdHash is provided and matches an existing queued request FROM
   * THE SAME ORIGIN, the existing PendingRequest is returned instead of
   * creating a duplicate. This collapses one page firing the same request twice
   * - a double-clicked button, a re-render - into a single prompt whose result
   * fans out to both pending promises.
   *
   * Two different origins requesting a byte-identical event get two independent
   * approvals. Resolving one never resolves the other.
   *
   * @param origin - The origin of the requesting dapp (e.g., "https://primal.net")
   * @param event - The unsigned Nostr event to be signed (NIP-01 format)
   * @param resolver - Callback invoked when request is resolved or times out
   * @param eventIdHash - Optional SHA-256 hash of the event ID for de-duplication
   * @returns The PendingRequest (new or existing if duplicate detected)
   *
   * @remarks
   * - De-duplication uses the requesting origin together with the event ID hash
   *   (computed via NIP-01 canonical serialization)
   * - Duplicate detection logs a message but does NOT trigger change notifications
   * - Both queue Map and eventIdMap are updated for new requests
   * - Auto-timeout is set up for each request (default 5 minutes)
   * - Change callback is invoked for new requests to trigger UI updates
   */
  enqueue(
    origin: string,
    event: UnsignedEvent,
    resolver: RequestResolver,
    eventIdHash?: string,
    options?: {
      signingPubkey?: string;
      clientRequestId?: string;
      exceededAutoSignBudget?: boolean;
    }
  ): PendingRequest {
    // Check for a duplicate from THIS origin. The key is built here, inside the
    // service, so no caller can forget to include the origin.
    const dedupeKey = eventIdHash ? makeDedupeKey(origin, eventIdHash) : undefined;
    if (dedupeKey && this.eventIdMap.has(dedupeKey)) {
      const existingEntry = this.eventIdMap.get(dedupeKey)!;
      existingEntry.resolvers.push(resolver);
      // Don't notify for duplicates - no actual queue change, and
      // deliberately no rate-limit charge: collapsing a double-click into
      // one prompt must not cost the page the same as asking twice.
      return existingEntry.request;
    }

    this.assertCapacity(origin);

    const now = Math.floor(Date.now() / 1000);
    const request: PendingRequest = {
      id: crypto.randomUUID(),
      origin,
      operation: "sign_event",
      event,
      eventIdHash,
      createdAt: now,
      timeoutAt: now + Math.floor(this.timeoutMs / 1000),
      signingPubkey: options?.signingPubkey,
      clientRequestId: options?.clientRequestId,
      ...(options?.exceededAutoSignBudget && { exceededAutoSignBudget: true }),
    };

    this.recordEnqueue(origin);

    // Set up timeout for auto-deny
    const timeoutId = setTimeout(() => {
      this.handleTimeout(request.id);
    }, this.timeoutMs);

    const entry: QueueEntry = {
      request,
      resolvers: [resolver],
      timeoutId,
      eventIdHash,
      dedupeKey,
    };
    this.queue.set(request.id, entry);

    // Track by (origin, event ID hash) if a hash was provided
    if (dedupeKey) {
      this.eventIdMap.set(dedupeKey, entry);
    }

    // Notify listeners that queue has changed
    this.notifyChange();

    return request;
  }

  /**
   * Enqueue a request to disclose the user's public key to an origin.
   *
   * De-duplicates on `(origin, "identity_disclosure")` rather than on an event
   * hash - there is no event to hash. One pending disclosure prompt per origin
   * is the correct semantics anyway: a page calling `getPublicKey` in a loop
   * must produce one prompt, not one per call.
   *
   * `assertCapacity` and the rolling per-origin allowance still apply, so a
   * flooding origin is refused here exactly as a flooding signer is. Because
   * the dedupe key collapses repeats from one origin into a single entry,
   * repeated disclosure requests from that origin cannot displace a pending
   * signing request from another.
   */
  enqueueDisclosure(
    origin: string,
    resolver: RequestResolver,
    options?: { signingPubkey?: string; clientRequestId?: string }
  ): PendingRequest {
    const dedupeKey = makeDedupeKey(origin, "identity_disclosure");
    const existingEntry = this.eventIdMap.get(dedupeKey);
    if (existingEntry) {
      existingEntry.resolvers.push(resolver);
      // No rate-limit charge and no notification: this is the same prompt.
      return existingEntry.request;
    }

    this.assertCapacity(origin);

    const now = Math.floor(Date.now() / 1000);
    const request: PendingRequest = {
      id: crypto.randomUUID(),
      origin,
      operation: "identity_disclosure",
      createdAt: now,
      timeoutAt: now + Math.floor(this.timeoutMs / 1000),
      signingPubkey: options?.signingPubkey,
      clientRequestId: options?.clientRequestId,
    };

    this.recordEnqueue(origin);

    const timeoutId = setTimeout(() => {
      this.handleTimeout(request.id);
    }, this.timeoutMs);

    const entry: QueueEntry = {
      request,
      resolvers: [resolver],
      timeoutId,
      dedupeKey,
    };
    this.queue.set(request.id, entry);
    this.eventIdMap.set(dedupeKey, entry);

    this.notifyChange();

    return request;
  }

  /**
   * Get the next pending request (oldest first - FIFO)
   * @returns The oldest pending request, or undefined if queue is empty
   */
  getNextPending(): PendingRequest | undefined {
    // Map preserves insertion order, so first entry is oldest
    const first = this.queue.values().next();
    return first.done ? undefined : first.value.request;
  }

  /**
   * Get a specific pending request by ID
   * @param requestId - The unique request ID
   * @returns The pending request, or undefined if not found
   */
  getById(requestId: string): PendingRequest | undefined {
    return this.queue.get(requestId)?.request;
  }

  /**
   * Get the count of pending requests
   * @returns Number of requests awaiting user decision
   */
  count(): number {
    return this.queue.size;
  }

  /**
   * Resolve a pending request with user's decision
   * @param requestId - The unique request ID
   * @param action - The user's action choice
   * @returns true if request was found and resolved, false if not found
   */
  resolve(requestId: string, action: ApprovalAction): boolean {
    const entry = this.queue.get(requestId);
    if (!entry) {
      return false;
    }

    // Clear the timeout since user made a decision
    clearTimeout(entry.timeoutId);

    // Map action to decision
    const decision: ApprovalDecision =
      action === "allow" || action === "allow_once" ? "allow" : "deny";

    // Remove from queue and event ID map before calling resolver (prevents double-resolve)
    this.queue.delete(requestId);
    if (entry.dedupeKey) {
      this.eventIdMap.delete(entry.dedupeKey);
    }

    // Call every resolver attached to this queue entry. Duplicate callers share
    // one visible approval but each pending RPC promise still needs a result.
    for (const resolveRequest of entry.resolvers) {
      resolveRequest(decision, action);
    }

    // Notify listeners that queue has changed
    this.notifyChange();

    return true;
  }

  /**
   * Handle timeout - auto-deny the request
   * @param requestId - The unique request ID
   */
  private handleTimeout(requestId: string): void {
    const entry = this.queue.get(requestId);
    if (!entry) {
      return;
    }

    // Mark this request as timed out
    this.timedOutRequests.add(requestId);

    // Remove from queue and event ID map
    this.queue.delete(requestId);
    if (entry.dedupeKey) {
      this.eventIdMap.delete(entry.dedupeKey);
    }

    // Auto-deny on timeout (no policy change)
    for (const resolveRequest of entry.resolvers) {
      resolveRequest("deny", "deny");
    }

    // Notify listeners that queue has changed
    this.notifyChange();
  }

  /**
   * Check if a request timed out (used by handlers to return appropriate error code)
   * @param requestId - The unique request ID
   * @returns true if request timed out, false otherwise
   */
  wasTimeout(requestId: string): boolean {
    return this.timedOutRequests.has(requestId);
  }

  /**
   * Clear all pending requests (used for cleanup/testing)
   * All pending requests will be auto-denied
   */
  clear(): void {
    for (const entry of this.queue.values()) {
      clearTimeout(entry.timeoutId);
      for (const resolveRequest of entry.resolvers) {
        resolveRequest("deny", "deny");
      }
    }
    this.queue.clear();
    this.eventIdMap.clear();
    this.timedOutRequests.clear();
  }

  /**
   * Check if there are any pending requests
   */
  hasPending(): boolean {
    return this.queue.size > 0;
  }

  /**
   * Get all pending requests (for UI display)
   * @returns Array of all pending requests in FIFO order
   */
  getAllPending(): PendingRequest[] {
    return Array.from(this.queue.values()).map((entry) => entry.request);
  }

  /**
   * Get queued event ID hashes (for diagnostics)
   * @returns Array of currently queued event ID hashes
   */
  getQueuedEventIds(): string[] {
    // The map is keyed by (origin, hash); diagnostics still want the hashes.
    //
    // The `!` here used to emit `undefined` into the array for any entry
    // that is keyed but carries no hash - which is every disclosure request,
    // since those dedupe on (origin, "identity_disclosure") and have no event
    // to hash. Filtered rather than asserted.
    return Array.from(this.eventIdMap.values())
      .map((entry) => entry.eventIdHash)
      .filter((hash): hash is string => hash !== undefined);
  }
}

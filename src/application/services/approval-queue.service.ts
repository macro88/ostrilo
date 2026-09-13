import {
  ApprovalDecision,
  ApprovalAction,
  PendingRequest,
  UnsignedEvent,
} from "@/domain/types";

/** Default timeout for approval requests (60 seconds) */
const DEFAULT_TIMEOUT_MS = 60_000;

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

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
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
    eventIdHash?: string
  ): PendingRequest {
    // Check for a duplicate from THIS origin. The key is built here, inside the
    // service, so no caller can forget to include the origin.
    const dedupeKey = eventIdHash ? makeDedupeKey(origin, eventIdHash) : undefined;
    if (dedupeKey && this.eventIdMap.has(dedupeKey)) {
      const existingEntry = this.eventIdMap.get(dedupeKey)!;
      existingEntry.resolvers.push(resolver);
      console.log(
        `[ApprovalQueue] Duplicate event detected for ${origin} (hash: ${eventIdHash!.substring(
          0,
          8
        )}...), reusing existing request ${existingEntry.request.id}`
      );
      // Don't notify for duplicates - no actual queue change
      return existingEntry.request;
    }

    const now = Math.floor(Date.now() / 1000);
    const request: PendingRequest = {
      id: crypto.randomUUID(),
      origin,
      event,
      eventIdHash,
      createdAt: now,
      timeoutAt: now + Math.floor(this.timeoutMs / 1000),
    };

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
    return Array.from(this.eventIdMap.values()).map(
      (entry) => entry.eventIdHash!
    );
  }
}

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
  resolver: RequestResolver;
  timeoutId: ReturnType<typeof setTimeout>;
  eventIdHash?: string; // Optional event ID hash for de-duplication
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
  private eventIdMap: Map<string, QueueEntry> = new Map(); // Track by event ID hash for de-duplication
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
   * Enqueue a new approval request
   * @param origin - The origin of the requesting dapp
   * @param event - The unsigned event to be signed
   * @param resolver - Callback invoked when request is resolved or times out
   * @param eventIdHash - Optional event ID hash for de-duplication
   * @returns The created PendingRequest with unique ID
   */
  enqueue(
    origin: string,
    event: UnsignedEvent,
    resolver: RequestResolver,
    eventIdHash?: string
  ): PendingRequest {
    // Check for duplicate by event ID hash
    if (eventIdHash && this.eventIdMap.has(eventIdHash)) {
      const existingEntry = this.eventIdMap.get(eventIdHash)!;
      console.log(
        `[ApprovalQueue] Duplicate event detected (hash: ${eventIdHash.substring(
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
      createdAt: now,
      timeoutAt: now + Math.floor(this.timeoutMs / 1000),
    };

    // Set up timeout for auto-deny
    const timeoutId = setTimeout(() => {
      this.handleTimeout(request.id);
    }, this.timeoutMs);

    const entry: QueueEntry = { request, resolver, timeoutId, eventIdHash };
    this.queue.set(request.id, entry);

    // Track by event ID hash if provided
    if (eventIdHash) {
      this.eventIdMap.set(eventIdHash, entry);
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
    if (entry.eventIdHash) {
      this.eventIdMap.delete(entry.eventIdHash);
    }

    // Call the resolver with the decision
    entry.resolver(decision, action);

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
    if (entry.eventIdHash) {
      this.eventIdMap.delete(entry.eventIdHash);
    }

    // Auto-deny on timeout (no policy change)
    entry.resolver("deny", "deny");

    // Notify listeners that queue has changed
    this.notifyChange();
  }

  /**
   * Check if a request timed out (used by handlers to return appropriate error code)
   * @param requestId - The unique request ID
   * @returns true if request timed out, false otherwise
   */
  wasTimeout(requestId: string): boolean {
    const result = this.timedOutRequests.has(requestId);
    // Clean up after checking
    this.timedOutRequests.delete(requestId);
    return result;
  }

  /**
   * Clear all pending requests (used for cleanup/testing)
   * All pending requests will be auto-denied
   */
  clear(): void {
    for (const [id, entry] of this.queue.entries()) {
      clearTimeout(entry.timeoutId);
      entry.resolver("deny", "deny");
    }
    this.queue.clear();
    this.eventIdMap.clear();
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
    return Array.from(this.eventIdMap.keys());
  }
}

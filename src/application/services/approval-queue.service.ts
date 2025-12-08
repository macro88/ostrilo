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

/** Internal request entry with resolver callback */
interface QueueEntry {
  request: PendingRequest;
  resolver: RequestResolver;
  timeoutId: ReturnType<typeof setTimeout>;
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
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Enqueue a new approval request
   * @param origin - The origin of the requesting dapp
   * @param event - The unsigned event to be signed
   * @param resolver - Callback invoked when request is resolved or times out
   * @returns The created PendingRequest with unique ID
   */
  enqueue(
    origin: string,
    event: UnsignedEvent,
    resolver: RequestResolver
  ): PendingRequest {
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

    this.queue.set(request.id, { request, resolver, timeoutId });
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

    // Remove from queue before calling resolver (prevents double-resolve)
    this.queue.delete(requestId);

    // Call the resolver with the decision
    entry.resolver(decision, action);

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

    // Remove from queue
    this.queue.delete(requestId);

    // Auto-deny on timeout (no policy change)
    entry.resolver("deny", "deny");
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
  }

  /**
   * Check if there are any pending requests
   */
  hasPending(): boolean {
    return this.queue.size > 0;
  }
}

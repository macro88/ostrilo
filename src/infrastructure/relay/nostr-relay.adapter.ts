import {
  INostrRelay,
  NostrFilter,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
} from "@/application/ports/relay";
import {
  RELAY_BOUNDS,
  RelayMessageSchema,
  boundNoticeText,
  verifyParsedRelayEvent,
} from "@/domain/relay";
import { isValidRelayUrl } from "@/domain/utils/validation";
import { NostrEventCrypto } from "@/infrastructure/crypto/adapters";

interface RelaySubscription {
  filter: NostrFilter;
  onEvent: NostrEventCallback;
  onEOSE?: NostrEOSECallback;
  acceptedEvents: number;
}

/**
 * Nostr Relay Adapter implementing INostrRelay port using WebSocket.
 *
 * This adapter is the extension's trust boundary for relay input. A relay is an
 * untrusted remote party, so every inbound frame crosses the following gate
 * before any subscription callback runs, cheapest check first:
 *
 * 1. the raw frame is size-checked before `JSON.parse`;
 * 2. the envelope is validated against the NIP-01 relay-to-client schema;
 * 3. the event payload is validated against a bounded NIP-01 event schema;
 * 4. the event is matched against the filter that created the subscription;
 * 5. the event ID is recomputed and compared;
 * 6. the Schnorr signature is verified.
 *
 * `onEvent` is therefore only ever called with an event whose ID and signature
 * verify and whose author and kind were asked for. Callers may re-check that
 * defensively, but they do not have to establish it themselves.
 *
 * Relay-controlled volume is bounded too: at most 20 events are accepted per
 * subscription, subscriptions close on EOSE so the registry drains, and
 * reconnection stops after 5 consecutive failures so an unreachable or hostile
 * relay cannot hold a permanent loop in the background worker.
 */
export class NostrRelayAdapter implements INostrRelay {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, RelaySubscription>();
  private pendingPublishes = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private gaveUpReconnecting = false;

  constructor(private relayUrl: string) {}

  /**
   * Connect to the relay WebSocket.
   */
  private async connect(): Promise<void> {
    if (!isValidRelayUrl(this.relayUrl)) {
      throw new Error(
        "Relay configuration error: relay URL must be a wss:// address"
      );
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkConnection = setInterval(() => {
          if (!this.isConnecting) {
            clearInterval(checkConnection);
            if (this.ws?.readyState === WebSocket.OPEN) {
              resolve();
            } else {
              reject(new Error("Connection failed"));
            }
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkConnection);
          reject(new Error("Connection timeout"));
        }, 10000);
      });
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.relayUrl);

        const timeout = setTimeout(() => {
          this.isConnecting = false;
          reject(new Error("Connection timeout"));
          this.ws?.close();
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.gaveUpReconnecting = false;
          resolve();
        };

        this.ws.onerror = () => {
          clearTimeout(timeout);
          this.isConnecting = false;
          console.error(`Relay connection error: ${this.relayUrl}`);
          reject(new Error("WebSocket connection error"));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.handleDisconnect();
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Reject a frame that is too large to be worth parsing.
   *
   * The character count is compared first because it is free and a UTF-8
   * encoding is never smaller than the UTF-16 code-unit count. The exact byte
   * measurement is only taken when multi-byte characters could still push a
   * short-looking string over the bound.
   */
  private exceedsFrameBound(raw: string): boolean {
    if (raw.length > RELAY_BOUNDS.MAX_FRAME_BYTES) {
      return true;
    }

    if (raw.length <= RELAY_BOUNDS.MAX_FRAME_BYTES / 4) {
      return false;
    }

    return (
      new TextEncoder().encode(raw).length > RELAY_BOUNDS.MAX_FRAME_BYTES
    );
  }

  /**
   * Handle incoming WebSocket messages.
   *
   * Never throws: this runs on a WebSocket callback whose stack has nowhere to
   * unwind, so a rejected frame is discarded rather than propagated.
   */
  private handleMessage(data: unknown): void {
    try {
      if (typeof data !== "string") {
        console.warn(`Discarded non-text relay frame from ${this.relayUrl}`);
        return;
      }

      if (this.exceedsFrameBound(data)) {
        console.warn(`Discarded oversized relay frame from ${this.relayUrl}`);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        console.warn(`Discarded unparseable relay frame from ${this.relayUrl}`);
        return;
      }

      const envelope = RelayMessageSchema.safeParse(parsed);
      if (!envelope.success) {
        console.warn(
          `Discarded malformed relay message from ${this.relayUrl}: ${envelope.error.issues[0]?.code ?? "invalid"}`
        );
        return;
      }

      const message = envelope.data;

      switch (message[0]) {
        case "EVENT": {
          this.handleEvent(message[1], message[2]);
          break;
        }

        case "EOSE": {
          this.handleEose(message[1]);
          break;
        }

        case "CLOSED": {
          console.warn(
            `Relay closed subscription: ${boundNoticeText(message[2])}`
          );
          this.handleEose(message[1]);
          break;
        }

        case "OK": {
          const [, eventId, success, message_] = message;
          const pending = this.pendingPublishes.get(eventId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingPublishes.delete(eventId);

            if (success) {
              pending.resolve();
            } else {
              pending.reject(
                new Error(`Publish failed: ${boundNoticeText(message_)}`)
              );
            }
          }
          break;
        }

        case "NOTICE": {
          console.warn(`Relay notice: ${boundNoticeText(message[1])}`);
          break;
        }

        case "AUTH": {
          // NIP-42 is not implemented; the challenge is acknowledged and dropped.
          console.warn(`Relay requested AUTH: ${this.relayUrl}`);
          break;
        }
      }
    } catch (error) {
      console.error(
        `Error handling relay message from ${this.relayUrl}:`,
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  /**
   * Verify one relay event and hand it to its subscription, or discard it.
   */
  private handleEvent(subId: string, payload: NostrEvent): void {
    const sub = this.subscriptions.get(subId);
    if (!sub) {
      return;
    }

    if (sub.acceptedEvents >= RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION) {
      return;
    }

    const verification = verifyParsedRelayEvent(
      NostrEventCrypto,
      payload,
      sub.filter
    );
    if (!verification.ok) {
      console.warn(
        `Discarded relay event from ${this.relayUrl}: ${verification.reason}`
      );
      return;
    }

    sub.acceptedEvents += 1;

    try {
      sub.onEvent(verification.event as NostrEvent);
    } catch (error) {
      console.error(
        "Subscription event handler failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    }

    if (sub.acceptedEvents >= RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION) {
      console.warn(
        `Relay event cap reached for subscription on ${this.relayUrl}`
      );
      this.handleEose(subId);
    }
  }

  /**
   * Settle and retire a subscription: signal end of stored events, send CLOSE,
   * and drop the handler so the registry drains and reconnection has no work
   * left to justify it.
   */
  private handleEose(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (!sub) {
      return;
    }

    this.subscriptions.delete(subId);
    this.sendClose(subId);

    try {
      sub.onEOSE?.();
    } catch (error) {
      console.error(
        "Subscription EOSE handler failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  /**
   * Best-effort CLOSE frame. The relay may already be gone, in which case
   * dropping the local handler is the whole job.
   */
  private sendClose(subId: string): void {
    try {
      this.send(["CLOSE", subId]);
    } catch {
      // The relay may already be disconnected.
    }
  }

  /**
   * Handle WebSocket disconnection.
   */
  private handleDisconnect(): void {
    if (this.subscriptions.size === 0 && this.pendingPublishes.size === 0) {
      return;
    }

    if (this.reconnectTimeout) {
      return; // Already attempting reconnect
    }

    if (this.reconnectAttempts >= RELAY_BOUNDS.MAX_RECONNECT_ATTEMPTS) {
      this.abandonReconnection();
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s, plus up to 20% jitter so a
    // fleet of clients does not retry a failed relay in lockstep.
    const base = Math.min(
      RELAY_BOUNDS.RECONNECT_BASE_DELAY_MS *
        Math.pow(2, this.reconnectAttempts),
      RELAY_BOUNDS.RECONNECT_MAX_DELAY_MS
    );
    const delay = Math.round(
      base * (1 + Math.random() * RELAY_BOUNDS.RECONNECT_JITTER_RATIO)
    );
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;

      try {
        await this.connect();

        // Re-establish subscriptions
        const subs = Array.from(this.subscriptions.entries());
        for (const [subId, sub] of subs) {
          this.send(["REQ", subId, sub.filter]);
        }
      } catch (error) {
        console.error(
          "Reconnection failed:",
          error instanceof Error ? error.message : "unknown error"
        );
        this.handleDisconnect();
      }
    }, delay);
  }

  /**
   * Stop reconnecting and settle everything that was waiting on this relay.
   *
   * A fetch blocked on a relay that will never answer is worse than a fetch
   * that returns nothing, so every subscription is given its EOSE on the way
   * out rather than being dropped silently.
   */
  private abandonReconnection(): void {
    console.warn(
      `Giving up on relay ${this.relayUrl} after ${this.reconnectAttempts} attempts`
    );
    this.gaveUpReconnecting = true;

    const orphaned = Array.from(this.subscriptions.values());
    this.subscriptions.clear();

    for (const sub of orphaned) {
      try {
        sub.onEOSE?.();
      } catch (error) {
        console.error(
          "Subscription EOSE handler failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    }

    for (const pending of this.pendingPublishes.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Relay unreachable"));
    }
    this.pendingPublishes.clear();
  }

  /**
   * Send message to relay.
   */
  private send(message: unknown[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error("Relay not connected");
    }
  }

  /**
   * Subscribe to events matching filter.
   */
  async subscribe(
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    // Ensure connection
    await this.connect();

    // Generate subscription ID
    const subId = crypto.randomUUID();

    // Store subscription
    this.subscriptions.set(subId, { filter, onEvent, onEOSE, acceptedEvents: 0 });

    // Send REQ message
    try {
      this.send(["REQ", subId, filter]);
    } catch (error) {
      this.subscriptions.delete(subId);
      throw error;
    }

    return subId;
  }

  /**
   * Publish event to relay.
   */
  async publish(event: NostrEvent): Promise<void> {
    // Ensure connection
    await this.connect();

    return new Promise((resolve, reject) => {
      // Send EVENT message
      this.send(["EVENT", event]);

      // Wait for OK response with timeout
      const timeout = setTimeout(() => {
        this.pendingPublishes.delete(event.id);
        reject(new Error("Publish timeout"));
      }, 5000);

      this.pendingPublishes.set(event.id, {
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Close subscription.
   */
  async close(subId: string): Promise<void> {
    if (this.subscriptions.has(subId)) {
      this.subscriptions.delete(subId);
      this.sendClose(subId);
    }
  }

  getRelayUrl(): string {
    return this.relayUrl;
  }

  /**
   * Number of subscriptions the adapter is still holding. Exposed so callers
   * and tests can assert the registry drains rather than leaking.
   */
  getActiveSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * True once the adapter has stopped trying to reach this relay.
   */
  hasAbandonedReconnection(): boolean {
    return this.gaveUpReconnecting;
  }

  /**
   * Disconnect from relay.
   */
  async disconnect(): Promise<void> {
    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Close all subscriptions
    for (const subId of this.subscriptions.keys()) {
      this.sendClose(subId);
    }
    this.subscriptions.clear();

    // Clear pending publishes
    for (const pending of this.pendingPublishes.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Disconnected"));
    }
    this.pendingPublishes.clear();

    // Close WebSocket
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
  }
}

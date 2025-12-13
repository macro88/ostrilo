import {
  INostrRelay,
  NostrFilter,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
} from "@/application/ports/relay";

/**
 * Nostr Relay Adapter implementing INostrRelay port using WebSocket.
 *
 * Features:
 * - WebSocket-based relay connection
 * - Subscription management with callbacks
 * - Event publishing with OK response handling
 * - Automatic reconnection with exponential backoff
 * - Service worker lifecycle awareness
 */
export class NostrRelayAdapter implements INostrRelay {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<
    string,
    {
      filter: NostrFilter;
      onEvent: NostrEventCallback;
      onEOSE?: NostrEOSECallback;
    }
  >();
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

  constructor(private relayUrl: string) {}

  /**
   * Connect to the relay WebSocket.
   */
  private async connect(): Promise<void> {
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
          console.log(`Connected to relay: ${this.relayUrl}`);
          resolve();
        };

        this.ws.onerror = (error) => {
          clearTimeout(timeout);
          this.isConnecting = false;
          console.error(`Relay connection error: ${this.relayUrl}`, error);
          reject(new Error("WebSocket connection error"));
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          console.log(`Disconnected from relay: ${this.relayUrl}`);
          this.handleDisconnect();
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      if (!Array.isArray(msg) || msg.length < 2) {
        console.warn("Invalid message format:", data);
        return;
      }

      const [type, ...rest] = msg;

      switch (type) {
        case "EVENT": {
          const [subId, event] = rest;
          const sub = this.subscriptions.get(subId);
          if (sub) {
            sub.onEvent(event as NostrEvent);
          }
          break;
        }

        case "EOSE": {
          const [subId] = rest;
          const sub = this.subscriptions.get(subId);
          if (sub?.onEOSE) {
            sub.onEOSE();
          }
          break;
        }

        case "OK": {
          const [eventId, success, message] = rest;
          const pending = this.pendingPublishes.get(eventId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingPublishes.delete(eventId);

            if (success) {
              pending.resolve();
            } else {
              pending.reject(new Error(`Publish failed: ${message}`));
            }
          }
          break;
        }

        case "NOTICE": {
          const [notice] = rest;
          console.warn(`Relay notice: ${notice}`);
          break;
        }

        default:
          console.warn(`Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error("Error handling relay message:", error, data);
    }
  }

  /**
   * Handle WebSocket disconnection.
   */
  private handleDisconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already attempting reconnect
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`Reconnecting to ${this.relayUrl} in ${delay}ms...`);

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
        console.error("Reconnection failed:", error);
      }
    }, delay);
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
    this.subscriptions.set(subId, { filter, onEvent, onEOSE });

    // Send REQ message
    this.send(["REQ", subId, filter]);

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
      this.send(["CLOSE", subId]);
      this.subscriptions.delete(subId);
    }
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
      try {
        this.send(["CLOSE", subId]);
      } catch (error) {
        // Ignore errors during disconnect
      }
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

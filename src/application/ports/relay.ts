/**
 * Nostr Relay Port Interface
 *
 * Abstraction for Nostr relay communication following the Hexagonal Architecture pattern.
 * This port is implemented by infrastructure adapters (e.g., WebSocket-based relay client).
 */

/**
 * Nostr event filter for relay subscriptions (NIP-01).
 */
export interface NostrFilter {
  ids?: string[]; // Event IDs
  authors?: string[]; // Public keys (hex)
  kinds?: number[]; // Event kinds
  since?: number; // Unix timestamp (inclusive)
  until?: number; // Unix timestamp (inclusive)
  limit?: number; // Maximum number of events
  [key: string]: any; // Allow custom filter fields
}

/**
 * Nostr event structure (NIP-01).
 */
export interface NostrEvent {
  id: string; // 32-byte hex event ID
  pubkey: string; // 32-byte hex public key
  created_at: number; // Unix timestamp
  kind: number; // Event kind
  tags: string[][]; // Tags (NIP-10, NIP-12, etc.)
  content: string; // Event content
  sig: string; // 64-byte hex signature
}

/**
 * Unsigned Nostr event (before signing).
 */
export interface UnsignedNostrEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/**
 * Relay subscription callback types.
 */
export type NostrEventCallback = (event: NostrEvent) => void;
export type NostrEOSECallback = () => void;

/**
 * INostrRelay port interface for relay communication.
 *
 * Provides methods to:
 * - Subscribe to events matching filters
 * - Publish events to the relay
 * - Close subscriptions
 * - Disconnect from relay
 */
export interface INostrRelay {
  /**
   * Subscribe to events matching the given filter.
   *
   * @param filter - Event filter criteria
   * @param onEvent - Callback for each matching event
   * @param onEOSE - Optional callback when relay signals end of stored events
   * @returns Subscription ID for later closing
   */
  subscribe(
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string>;

  /**
   * Publish a signed event to the relay.
   *
   * @param event - Signed Nostr event
   * @returns Promise that resolves on success (OK true) or rejects on failure
   */
  publish(event: NostrEvent): Promise<void>;

  /**
   * Close an active subscription.
   *
   * @param subId - Subscription ID returned from subscribe()
   */
  close(subId: string): Promise<void>;

  /**
   * Disconnect from the relay and clean up resources.
   */
  disconnect(): Promise<void>;
}

// Dummy export to prevent "empty module" issues in Vitest
export const RELAY_PORT_VERSION = "1.0.0";

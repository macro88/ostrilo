import {
  INostrRelay,
  NostrFilter,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
} from "@/application/ports/relay";
import { NostrRelayAdapter } from "./nostr-relay.adapter";

/**
 * Relay Manager implementing INostrRelay port with multi-relay support.
 *
 * Features:
 * - Manages multiple relay connections
 * - Queries all relays in parallel
 * - Merges results and deduplicates events
 * - Selects best event by created_at timestamp
 * - Publishes to all relays
 */
export class RelayManager implements INostrRelay {
  private relays: NostrRelayAdapter[] = [];

  constructor(relayUrls: string[]) {
    this.setRelayAdapters(relayUrls);
  }

  async setRelayUrls(relayUrls: string[]): Promise<void> {
    await this.disconnect();
    this.setRelayAdapters(relayUrls);
  }

  private setRelayAdapters(relayUrls: string[]): void {
    this.relays = relayUrls.map((url) => new NostrRelayAdapter(url));
  }

  /**
   * Subscribe to events matching filter across all relays.
   * Deduplicates events by ID and calls onEvent once per unique event.
   */
  async subscribe(
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string> {
    if (this.relays.length === 0) {
      onEOSE?.();
      return "";
    }

    // Track seen event IDs to deduplicate
    const seenEventIds = new Set<string>();

    // Wrap callback to deduplicate
    const deduplicatedCallback: NostrEventCallback = (event: NostrEvent) => {
      if (!seenEventIds.has(event.id)) {
        seenEventIds.add(event.id);
        onEvent(event);
      }
    };

    // Track EOSE from all relays
    let eoseCount = 0;
    let expectedEoseCount = this.relays.length;
    let didCallEOSE = false;
    const maybeCallEOSE = () => {
      if (!didCallEOSE && onEOSE && eoseCount >= expectedEoseCount) {
        didCallEOSE = true;
        onEOSE();
      }
    };
    const wrappedEOSE: NostrEOSECallback | undefined = onEOSE
      ? () => {
          eoseCount++;
          maybeCallEOSE();
        }
      : undefined;

    // Subscribe to all relays in parallel
    const results = await Promise.allSettled(
      this.relays.map((relay) =>
        relay.subscribe(filter, deduplicatedCallback, wrappedEOSE)
      )
    );

    const successfulSubscriptions = results.filter(
      (result) => result.status === "fulfilled"
    ).length;

    if (successfulSubscriptions === 0) {
      const errors = results.reduce<string[]>((messages, result) => {
        if (result.status === "rejected") {
          messages.push(result.reason?.message ?? String(result.reason));
        }

        return messages;
      }, []).join(", ");

      console.warn(`Relay subscription failed on all relays: ${errors}`);
      onEOSE?.();
      return results.map(() => "").join(",");
    }

    expectedEoseCount = successfulSubscriptions;
    maybeCallEOSE();

    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      console.warn(
        `Relay subscription succeeded on ${successfulSubscriptions}/${results.length} relays`
      );
    }

    // Return composite subscription ID (all relay subIds joined)
    return results
      .map((result) => (result.status === "fulfilled" ? result.value : ""))
      .join(",");
  }

  /**
   * Publish event to all relays in parallel.
   * Succeeds if at least one relay accepts the event.
   */
  async publish(event: NostrEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.relays.map((relay) => relay.publish(event))
    );

    // Check if at least one relay succeeded
    const anySuccess = results.some((r) => r.status === "fulfilled");

    if (!anySuccess) {
      const errors = results.reduce<string[]>((messages, result) => {
        if (result.status === "rejected") {
          messages.push(result.reason.message);
        }

        return messages;
      }, []).join(", ");

      throw new Error(`Publish failed on all relays: ${errors}`);
    }

    // Log partial failures
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.warn(
        `Publish succeeded on ${results.length - failures.length}/${
          results.length
        } relays`
      );
    }
  }

  /**
   * Close subscription across all relays.
   * The subId is expected to be a comma-separated list of relay subIds.
   */
  async close(subId: string): Promise<void> {
    const subIds = subId.split(",");

    if (subIds.length !== this.relays.length) {
      console.warn(
        `Subscription ID count mismatch: expected ${this.relays.length}, got ${subIds.length}`
      );
    }

    await Promise.all(
      this.relays.map((relay, index) => {
        const relaySubId = subIds[index];
        return relaySubId ? relay.close(relaySubId) : Promise.resolve();
      })
    );
  }

  /**
   * Disconnect from all relays.
   */
  async disconnect(): Promise<void> {
    await Promise.all(this.relays.map((relay) => relay.disconnect()));
  }

  /**
   * Get number of relays managed.
   */
  getRelayCount(): number {
    return this.relays.length;
  }

  /**
   * Get relay URLs.
   */
  getRelayUrls(): string[] {
    return this.relays.map((relay) => relay.getRelayUrl());
  }
}

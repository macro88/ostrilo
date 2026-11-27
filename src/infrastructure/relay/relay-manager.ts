import {
  IRelayRouter,
  RelayPublishResult,
  NostrFilter,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
} from "@/application/ports/relay";
import { NostrRelayAdapter } from "./nostr-relay.adapter";
import { RELAY_BOUNDS, sanitizeRelayUrls, normalizedRelayUrl, isRoutableRelayHost, RelayUrlSchema } from "@/domain/relay";

/**
 * Relay Manager implementing INostrRelay port with multi-relay support.
 *
 * Features:
 * - Manages multiple relay connections
 * - Queries all relays in parallel
 * - Merges results and deduplicates events
 * - Selects best event by created_at timestamp
 * - Publishes to all relays
 *
 * The manager inherits NostrRelayAdapter's verification contract: every event
 * passed to onEvent has had its ID recomputed, its Schnorr signature verified,
 * and its author and kind matched against the subscription filter.
 *
 * Relay URLs are sanitised and bounded here as well as at the settings
 * boundary, so a stored cleartext or over-long relay list cannot open a
 * connection even if it reaches this far.
 */
export class RelayManager implements IRelayRouter {
  private relays: NostrRelayAdapter[] = [];
  private relayUrls: string[] = [];

  private transient = new Set<NostrRelayAdapter>();
  private transientSubscriptions = new Map<string, NostrRelayAdapter>();

  private openTransient(url: string) {
    if (
      !RelayUrlSchema.safeParse(url).success ||
      !isRoutableRelayHost(url) ||
      this.transient.size >= RELAY_BOUNDS.MAX_TRANSIENT_RELAYS
    ) {
      throw new Error("Relay destination is unavailable");
    }
    const relay = new NostrRelayAdapter(url);
    this.transient.add(relay);
    return relay;
  }

  private async release(relay: NostrRelayAdapter) {
    if (this.transient.delete(relay)) await relay.disconnect();
  }

  constructor(relayUrls: string[]) {
    this.setRelayAdapters(relayUrls);
  }

  /**
   * Replace the relay list. A list that sanitises to the one already in use is
   * a no-op: callers apply this on every settings write, and rebuilding would
   * drop every open socket and live subscription for a change (a theme, say)
   * that did not touch the relays.
   */
  async setRelayUrls(relayUrls: string[]): Promise<void> {
    const accepted = sanitizeRelayUrls(relayUrls);
    const unchanged =
      accepted.length === this.relayUrls.length &&
      accepted.every((url, index) => url === this.relayUrls[index]);
    if (unchanged) return;

    await this.disconnect();
    this.setRelayAdapters(relayUrls);
  }

  private setRelayAdapters(relayUrls: string[]): void {
    const accepted = sanitizeRelayUrls(relayUrls);

    if (accepted.length < relayUrls.length) {
      console.warn(
        `Ignored ${relayUrls.length - accepted.length} relay URL(s): only up to ` +
          `${RELAY_BOUNDS.MAX_CONFIGURED_RELAYS} wss:// relays are accepted`
      );
    }

    this.relayUrls = accepted;
    this.relays = accepted.map((url) => new NostrRelayAdapter(url));
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
   * A discovery relay uses its existing connection and positional subscription ID.
   * A public write relay uses a temporary connection closed by EOSE or the caller.
   */
  async subscribeOn(
    relayUrl: string,
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback,
    onDiscard?: () => void
  ): Promise<string> {
    const index = this.relays.findIndex(
      (relay) => normalizedRelayUrl(relay.getRelayUrl()) === normalizedRelayUrl(relayUrl)
    );

    if (index === -1) {
      return this.subscribeTransient(relayUrl, filter, onEvent, onEOSE, onDiscard);
    }

    const subIds = this.relays.map(() => "");

    try {
      subIds[index] = await this.relays[index].subscribe(
        filter,
        onEvent,
        onEOSE,
        onDiscard
      );
    } catch (error) {
      console.warn(
        `Relay subscription failed on ${relayUrl}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      onEOSE?.({ complete: false, discarded: 0 });
    }

    return subIds.join(",");
  }

  private async subscribeTransient(
    url: string,
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback,
    onDiscard?: () => void
  ) {
    const adapter = this.openTransient(url);
    const token = "transient-" + crypto.randomUUID();
    this.transientSubscriptions.set(token, adapter);
    const release = () => {
      this.transientSubscriptions.delete(token);
      return this.release(adapter);
    };
    try {
      await adapter.subscribe(filter, onEvent, summary => {
        void release();
        onEOSE?.(summary);
      }, onDiscard);
      return token;
    } catch (error) {
      await release();
      throw error;
    }
  }

  async publishTo(urls: string[], event: NostrEvent): Promise<RelayPublishResult[]> {
    return Promise.all([...new Set(urls)].map(async url => {
      const existing = this.relays.find(relay => normalizedRelayUrl(relay.getRelayUrl()) === normalizedRelayUrl(url));
      let temporary: NostrRelayAdapter | undefined;
      try {
        const adapter = existing ?? (temporary = this.openTransient(url));
        await adapter.publish(event);
        return { url, accepted: true };
      } catch {
        return { url, accepted: false };
      } finally {
        if (temporary) await this.release(temporary);
      }
    }));
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
    if (subId.startsWith("transient-")) {
      const adapter = this.transientSubscriptions.get(subId);
      this.transientSubscriptions.delete(subId);
      if (adapter) await this.release(adapter);
      return;
    }
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
    this.transientSubscriptions.clear();
    await Promise.all([...this.transient].map(relay => this.release(relay)));
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

import { StorageSuite } from "@/application/ports/storage";
import {
  INostrRelay,
  NostrEvent,
  NostrEventCallback,
  NostrEOSECallback,
  NostrFilter,
} from "@/application/ports/relay";
import { KeyVaultService } from "./key-vault.service";
import {
  ProfileMetadata,
  ProfileCacheEntry,
  boundProfileMetadata,
  validateProfileMetadata,
} from "@/domain/profile/types";
import {
  RELAY_BOUNDS,
  alternateRelay,
  assignRelay,
  createPartitionSalt,
  isPartitionSalt,
} from "@/domain/relay";

const PROFILE_CACHE_STORAGE = "profileCache";
const PARTITION_SALT_STORAGE = "relayPartitionSalt";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const PROFILE_EVENT_KIND = 0;

/**
 * A relay implementation that can answer on one named relay instead of fanning
 * a query out to every configured relay. `RelayManager` provides this; a bare
 * single-relay adapter does not, and does not need to.
 */
interface PartitionableRelay {
  getRelayUrls(): string[];
  subscribeOn(
    relayUrl: string,
    filter: NostrFilter,
    onEvent: NostrEventCallback,
    onEOSE?: NostrEOSECallback
  ): Promise<string>;
}

/**
 * ProfileService - Application layer service for Nostr profile metadata management.
 *
 * Responsibilities:
 * - Fetch profile metadata from relays (NIP-01 kind:0 events)
 * - Cache profiles locally with TTL
 * - Validate and sanitize profile data
 * - Publish profile updates
 * - Manage cache lifecycle (expiration, eviction)
 */
/** The profile could not be attributed to a key: none is selected, or it no longer exists. */
export class ProfileKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileKeyUnavailableError";
  }
}

/** The profile was signed but no relay accepted it. */
export class ProfilePublishError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "No relay accepted the event");
    this.name = "ProfilePublishError";
    this.cause = cause;
  }
}

export class ProfileService {
  private legacyPurge: Promise<void> | null = null;

  constructor(
    private storage: StorageSuite,
    private relay: INostrRelay,
    private keyVault: KeyVaultService
  ) {}

  /**
   * Get profile metadata for a public key.
   * Uses cache-first strategy with TTL-based expiration.
   *
   * @param pubkey - Hex public key
   * @param forceFetch - If true, bypass cache and query relays
   * @returns Profile metadata or null if not found
   */
  async getProfile(
    pubkey: string,
    forceFetch = false
  ): Promise<ProfileMetadata | null> {
    try {
      // Check cache first unless forceFetch
      if (!forceFetch) {
        const cached = await this.getCachedProfile(pubkey);
        if (cached && !this.isCacheExpired(cached)) {
          return cached.metadata;
        }
      }

      // An explicit refresh concerns one identity the user is already looking
      // at, so it may ask every configured relay. Routine hydration must not:
      // that is what would hand each relay the user's whole identity set.
      const profile = forceFetch
        ? await this.fetchProfileFromRelay(pubkey)
        : await this.fetchPartitionedProfile(pubkey);

      // Cache the result (even if null to avoid repeated failures)
      if (profile) {
        await this.cacheProfile(pubkey, profile);
      }

      return profile;
    } catch (error) {
      console.error(`Failed to get profile for ${pubkey}:`, error);

      // Fallback to cached profile (even if expired)
      const cached = await this.getCachedProfile(pubkey);
      return cached?.metadata ?? null;
    }
  }

  /**
   * Get all profiles for keys managed by KeyVaultService.
   *
   * Each pubkey is fetched through the non-forced path, so each is asked about
   * on its one assigned relay with a single-author filter rather than broadcast
   * to every configured relay.
   *
   * @returns Map of pubkey -> ProfileMetadata (omits null profiles)
   */
  async getAllProfiles(): Promise<Map<string, ProfileMetadata>> {
    const keys = await this.keyVault.listKeys();
    const profiles = new Map<string, ProfileMetadata>();

    const results = await Promise.all(
      keys.map(async (key) => ({
        pubkey: key.pubkey,
        profile: await this.getProfile(key.pubkey),
      }))
    );

    for (const { pubkey, profile } of results) {
      if (profile) {
        profiles.set(pubkey, profile);
      }
    }

    return profiles;
  }

  /**
   * Update and publish profile metadata for the currently selected key.
   *
   * @param metadata - New profile metadata
   * @throws Error if validation fails or publish fails
   */
  async updateProfile(metadata: ProfileMetadata): Promise<void> {
    // Validate metadata
    const validated = validateProfileMetadata(metadata);
    if (!validated) {
      throw new Error("Profile metadata validation failed");
    }

    // Get selected key
    const [settings, keys] = await Promise.all([
      this.keyVault.getSettings(),
      this.keyVault.listKeys(),
    ]);
    if (!settings?.selectedKeyId) {
      throw new ProfileKeyUnavailableError("No key selected");
    }

    const selectedKey = keys.find((k) => k.id === settings.selectedKeyId);
    if (!selectedKey) {
      throw new ProfileKeyUnavailableError("Selected key not found");
    }

    // Construct unsigned kind:0 event
    const unsignedEvent = {
      pubkey: selectedKey.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 0,
      tags: [] as string[][],
      content: JSON.stringify(validated),
    };

    // Signed by the key whose pubkey the event carries. Without the ID the
    // vault used to pick its first key, so a profile for any other selected key
    // carried that key's pubkey and another key's signature.
    const signedEvent = await this.keyVault.signEvent(
      unsignedEvent,
      selectedKey.id
    );

    // Publish to relay and update cache optimistically
    await Promise.all([
      this.relay.publish(signedEvent).catch((error: unknown) => {
        throw new ProfilePublishError(error);
      }),
      this.cacheProfile(selectedKey.pubkey, validated, signedEvent.id),
    ]);
  }

  /**
   * Clear cached profile for a specific pubkey.
   *
   * @param pubkey - Hex public key (if omitted, clears all profiles)
   */
  async clearCache(pubkey?: string): Promise<void> {
    if (pubkey) {
      const cache = await this.loadCache();
      delete cache[pubkey];
      await this.saveCache(cache);
    } else {
      await this.storage.session.remove(PROFILE_CACHE_STORAGE);
    }

    await this.purgeLegacyLocalCache();
  }

  /**
   * Narrow the relay port to one that can query a single named relay, when the
   * composed implementation supports it.
   */
  private asPartitionable(): PartitionableRelay | null {
    const candidate = this.relay as Partial<PartitionableRelay>;
    return typeof candidate.getRelayUrls === "function" &&
      typeof candidate.subscribeOn === "function"
      ? (candidate as PartitionableRelay)
      : null;
  }

  /**
   * The per-install salt that makes relay assignment unpredictable.
   *
   * Held in local storage because the assignment must be stable across browser
   * restarts to be worth anything: a salt regenerated each session would reshuffle
   * the partition and, over time, show every relay every pubkey. This is an
   * extension-generated random value, not relay-derived data.
   */
  private async getPartitionSalt(): Promise<string> {
    const stored = await this.storage.local.get<string>(
      PARTITION_SALT_STORAGE
    );
    if (isPartitionSalt(stored)) {
      return stored;
    }

    const salt = createPartitionSalt();
    try {
      await this.storage.local.set(PARTITION_SALT_STORAGE, salt);
    } catch (error) {
      console.warn(
        "Could not persist relay partition salt:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
    return salt;
  }

  /**
   * Fetch a profile on the one relay assigned to this pubkey.
   *
   * With zero or one configured relay there is nothing to partition and the
   * ordinary fetch is used; with more than one, the pubkey goes to its assigned
   * relay and, if that fails, to exactly one alternate. It is never retried
   * across the whole list, because doing so on failure would hand every relay
   * the identity the partition was meant to keep from it.
   */
  private async fetchPartitionedProfile(
    pubkey: string
  ): Promise<ProfileMetadata | null> {
    const partitionable = this.asPartitionable();
    const relayUrls = partitionable?.getRelayUrls() ?? [];

    if (!partitionable || relayUrls.length <= 1) {
      return this.fetchProfileFromRelay(pubkey);
    }

    const salt = await this.getPartitionSalt();

    const assigned = assignRelay(pubkey, salt, relayUrls);
    const primary = assigned
      ? await this.fetchProfileFromRelay(pubkey, assigned)
      : null;
    if (primary) {
      return primary;
    }

    const alternate = alternateRelay(pubkey, salt, relayUrls);
    return alternate
      ? await this.fetchProfileFromRelay(pubkey, alternate)
      : null;
  }

  /**
   * Fetch profile from relay.
   *
   * Structured around a single `settle()` so that "this promise always
   * resolves" is a property of the shape rather than of every branch being
   * right. The deadline is armed before `subscribe` is called, so a subscribe
   * that never resolves cannot hang the fetch; EOSE, the accepted-event cap,
   * a handler that throws, and the deadline all route through the same guard,
   * and only the first one wins.
   *
   * @param pubkey - Hex public key to fetch
   * @param relayUrl - When given, query only this relay
   */
  private fetchProfileFromRelay(
    pubkey: string,
    relayUrl?: string
  ): Promise<ProfileMetadata | null> {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      let settled = false;
      let subId: string | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const closeSubscription = (id: string) => {
        void Promise.resolve(this.relay.close(id)).catch(() => {
          // Closing is best effort; the relay may already be gone.
        });
      };

      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;

        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }

        const openSubId = subId;
        subId = null;
        if (openSubId) {
          closeSubscription(openSubId);
        }

        let result: ProfileMetadata | null = null;
        try {
          result = this.parseProfileEvents(pubkey, events);
        } catch (error) {
          console.warn(
            "Failed to select a profile event:",
            error instanceof Error ? error.message : "unknown error"
          );
        }

        resolve(result);
      };

      // Armed before subscribe, not inside its continuation.
      timeoutId = setTimeout(settle, RELAY_BOUNDS.FETCH_DEADLINE_MS);

      const onEvent: NostrEventCallback = (event) => {
        try {
          if (settled) {
            return;
          }

          // Defensive re-check. The adapter already verified and filtered, but
          // the application layer must not depend solely on that.
          if (
            !event ||
            event.pubkey !== pubkey ||
            event.kind !== PROFILE_EVENT_KIND
          ) {
            return;
          }

          events.push(event);

          if (events.length >= RELAY_BOUNDS.MAX_EVENTS_PER_SUBSCRIPTION) {
            settle();
          }
        } catch (error) {
          console.warn(
            "Profile event handler failed:",
            error instanceof Error ? error.message : "unknown error"
          );
          settle();
        }
      };

      const onEOSE: NostrEOSECallback = () => {
        settle();
      };

      const filter: NostrFilter = {
        kinds: [PROFILE_EVENT_KIND],
        authors: [pubkey],
        limit: 1,
      };

      const partitionable = relayUrl ? this.asPartitionable() : null;
      const subscription = partitionable
        ? partitionable.subscribeOn(relayUrl!, filter, onEvent, onEOSE)
        : this.relay.subscribe(filter, onEvent, onEOSE);

      Promise.resolve(subscription)
        .then((id) => {
          if (settled) {
            // EOSE or the deadline already won; retire the subscription now
            // that we finally know its ID.
            if (id) {
              closeSubscription(id);
            }
            return;
          }
          subId = id;
        })
        .catch((error) => {
          console.error(
            "Relay subscription failed:",
            error instanceof Error ? error.message : "unknown error"
          );
          settle();
        });
    });
  }

  /**
   * Parse kind:0 events and return most recent profile.
   *
   * The selection runs inside the try. It used to sit outside it, so a relay
   * that sent a malformed payload could throw a TypeError out of the EOSE
   * callback, where the adapter's catch swallowed it and the fetch never
   * settled.
   */
  private parseProfileEvents(
    pubkey: string,
    events: NostrEvent[]
  ): ProfileMetadata | null {
    try {
      const candidates = events.filter(
        (event) =>
          !!event &&
          event.pubkey === pubkey &&
          event.kind === PROFILE_EVENT_KIND &&
          typeof event.content === "string" &&
          typeof event.created_at === "number"
      );

      if (candidates.length === 0) {
        return null;
      }

      // Select event with highest created_at
      const mostRecent = candidates.reduce((prev, current) =>
        current.created_at > prev.created_at ? current : prev
      );

      const parsed = JSON.parse(mostRecent.content);
      return validateProfileMetadata(parsed);
    } catch (error) {
      console.warn(
        "Failed to parse profile event content:",
        error instanceof Error ? error.message : "unknown error"
      );
      return {}; // Return empty profile instead of null
    }
  }

  /**
   * Delete the profile cache a previous version kept in `browser.storage.local`.
   *
   * Nothing is migrated. No entry in that record was ever signature-checked, so
   * a poisoned name or avatar would otherwise survive the fix that stops new
   * ones being written. Removing it also takes relay-derived bytes out of the
   * area that holds `encryptedKeys`, where they competed with key writes.
   *
   * Runs at most once per service instance; safe to call at startup.
   */
  async purgeLegacyLocalCache(): Promise<void> {
    this.legacyPurge ??= (async () => {
      try {
        const legacy = await this.storage.local.get(PROFILE_CACHE_STORAGE);
        if (legacy !== undefined) {
          await this.storage.local.remove(PROFILE_CACHE_STORAGE);
          console.warn(
            "Removed legacy unverified profile cache from local storage"
          );
        }
      } catch (error) {
        console.warn(
          "Could not purge legacy profile cache:",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    })();

    return this.legacyPurge;
  }

  /**
   * Load all cached profiles from storage.
   */
  private async loadCache(): Promise<Record<string, ProfileCacheEntry>> {
    await this.purgeLegacyLocalCache();

    return (
      (await this.storage.session.get<Record<string, ProfileCacheEntry>>(
        PROFILE_CACHE_STORAGE
      )) ?? {}
    );
  }

  /**
   * Trim a cache to the entry and byte budgets, oldest entries first.
   *
   * The byte budget is measured, not assumed: a relay chooses the content of
   * every entry, so the only honest way to stay inside the budget is to
   * serialise the candidate cache and look.
   */
  private boundCache(
    cache: Record<string, ProfileCacheEntry>
  ): Record<string, ProfileCacheEntry> {
    const encoder = new TextEncoder();
    let entries = Object.values(cache).sort(
      (a, b) => a.fetchedAt - b.fetchedAt
    );

    if (entries.length > RELAY_BOUNDS.MAX_CACHE_ENTRIES) {
      entries = entries.slice(-RELAY_BOUNDS.MAX_CACHE_ENTRIES);
    }

    const toRecord = (list: ProfileCacheEntry[]) =>
      Object.fromEntries(list.map((entry) => [entry.pubkey, entry]));

    let record = toRecord(entries);
    while (
      entries.length > 0 &&
      encoder.encode(JSON.stringify(record)).length >
        RELAY_BOUNDS.MAX_CACHE_BYTES
    ) {
      entries.shift();
      record = toRecord(entries);
    }

    return record;
  }

  /**
   * Save all cached profiles to storage.
   *
   * Writes to session storage, which holds no key material, and never throws.
   * A cache is a convenience; a failed write of one must not be reported to the
   * caller as a failed profile fetch, and must never be able to affect a key
   * record write.
   */
  private async saveCache(
    cache: Record<string, ProfileCacheEntry>
  ): Promise<void> {
    try {
      await this.storage.session.set(
        PROFILE_CACHE_STORAGE,
        this.boundCache(cache)
      );
    } catch (error) {
      console.warn(
        "Profile cache write failed; continuing without caching:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  /**
   * Get cached profile entry.
   */
  private async getCachedProfile(
    pubkey: string
  ): Promise<ProfileCacheEntry | null> {
    const cache = await this.loadCache();
    return cache[pubkey] ?? null;
  }

  /**
   * Check if cache entry is expired.
   */
  private isCacheExpired(entry: ProfileCacheEntry): boolean {
    const now = Math.floor(Date.now() / 1000);
    const age = now - entry.fetchedAt;
    return age > entry.ttl;
  }

  /**
   * Cache profile metadata with TTL.
   */
  private async cacheProfile(
    pubkey: string,
    metadata: ProfileMetadata,
    eventId?: string
  ): Promise<void> {
    const { metadata: bounded, droppedFields } =
      boundProfileMetadata(metadata);

    if (droppedFields.length > 0) {
      console.warn(
        `Profile metadata exceeded the size bound; dropped: ${droppedFields.join(
          ", "
        )}`
      );
    }

    const cache = await this.loadCache();

    cache[pubkey] = {
      pubkey,
      metadata: bounded,
      fetchedAt: Math.floor(Date.now() / 1000),
      ttl: DEFAULT_TTL_SECONDS,
      eventId,
    };

    // Entry and byte budgets are applied in saveCache, which evicts
    // oldest-first until the serialised cache fits.
    await this.saveCache(cache);
  }
}

import { StorageSuite } from "@/application/ports/storage";
import { INostrRelay, NostrEvent } from "@/application/ports/relay";
import { KeyVaultService } from "./key-vault.service";
import {
  ProfileMetadata,
  ProfileCacheEntry,
  validateProfileMetadata,
} from "@/domain/profile/types";

const PROFILE_CACHE_STORAGE = "profileCache";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour
const MAX_CACHE_ENTRIES = 50;

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
export class ProfileService {
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

      // Query relay for kind:0 events
      const profile = await this.fetchProfileFromRelay(pubkey);

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
   * @returns Map of pubkey -> ProfileMetadata (omits null profiles)
   */
  async getAllProfiles(): Promise<Map<string, ProfileMetadata>> {
    const keys = await this.keyVault.listKeys();
    const profiles = new Map<string, ProfileMetadata>();

    for (const key of keys) {
      const profile = await this.getProfile(key.pubkey);
      if (profile) {
        profiles.set(key.pubkey, profile);
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
    const settings = await this.keyVault.getSettings();
    if (!settings?.selectedKeyId) {
      throw new Error("No key selected");
    }

    const keys = await this.keyVault.listKeys();
    const selectedKey = keys.find((k) => k.id === settings.selectedKeyId);
    if (!selectedKey) {
      throw new Error("Selected key not found");
    }

    // Construct unsigned kind:0 event
    const unsignedEvent = {
      pubkey: selectedKey.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 0,
      tags: [] as string[][],
      content: JSON.stringify(validated),
    };

    // Sign event via KeyVaultService
    const signedEvent = await this.keyVault.signEvent(unsignedEvent);

    // Publish to relay
    await this.relay.publish(signedEvent);

    // Update cache optimistically
    await this.cacheProfile(selectedKey.pubkey, validated, signedEvent.id);
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
      await this.storage.local.remove(PROFILE_CACHE_STORAGE);
    }
  }

  /**
   * Fetch profile from relay.
   */
  private async fetchProfileFromRelay(
    pubkey: string
  ): Promise<ProfileMetadata | null> {
    return new Promise((resolve) => {
      const events: NostrEvent[] = [];
      let timeoutId: NodeJS.Timeout;

      // Subscribe to kind:0 events by author
      this.relay
        .subscribe(
          {
            kinds: [0],
            authors: [pubkey],
            limit: 10, // Get recent events
          },
          (event) => {
            events.push(event);
          },
          () => {
            // EOSE received
            clearTimeout(timeoutId);
            resolve(this.parseProfileEvents(events));
          }
        )
        .then((subId) => {
          // Timeout after 5 seconds
          timeoutId = setTimeout(async () => {
            await this.relay.close(subId);
            resolve(this.parseProfileEvents(events));
          }, 5000);
        })
        .catch((error) => {
          console.error("Relay subscription failed:", error);
          resolve(null);
        });
    });
  }

  /**
   * Parse kind:0 events and return most recent profile.
   */
  private parseProfileEvents(events: NostrEvent[]): ProfileMetadata | null {
    if (events.length === 0) {
      return null;
    }

    // Select event with highest created_at
    const mostRecent = events.reduce((prev, current) =>
      current.created_at > prev.created_at ? current : prev
    );

    // Parse JSON content
    try {
      const parsed = JSON.parse(mostRecent.content);
      return validateProfileMetadata(parsed);
    } catch (error) {
      console.warn("Failed to parse profile event content:", error);
      return {}; // Return empty profile instead of null
    }
  }

  /**
   * Load all cached profiles from storage.
   */
  private async loadCache(): Promise<Record<string, ProfileCacheEntry>> {
    return (
      (await this.storage.local.get<Record<string, ProfileCacheEntry>>(
        PROFILE_CACHE_STORAGE
      )) ?? {}
    );
  }

  /**
   * Save all cached profiles to storage.
   */
  private async saveCache(
    cache: Record<string, ProfileCacheEntry>
  ): Promise<void> {
    await this.storage.local.set(PROFILE_CACHE_STORAGE, cache);
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
    const cache = await this.loadCache();

    // Check cache size and evict if needed
    if (Object.keys(cache).length >= MAX_CACHE_ENTRIES) {
      await this.evictOldestCache(cache);
    }

    const entry: ProfileCacheEntry = {
      pubkey,
      metadata,
      fetchedAt: Math.floor(Date.now() / 1000),
      ttl: DEFAULT_TTL_SECONDS,
      eventId,
    };

    cache[pubkey] = entry;
    await this.saveCache(cache);
  }

  /**
   * Evict oldest cache entry if limit exceeded (LRU).
   */
  private async evictOldestCache(
    cache: Record<string, ProfileCacheEntry>
  ): Promise<void> {
    const entries = Object.values(cache);
    if (entries.length === 0) return;

    // Find oldest entry by fetchedAt
    const oldest = entries.reduce((prev, current) =>
      current.fetchedAt < prev.fetchedAt ? current : prev
    );

    delete cache[oldest.pubkey];
  }
}

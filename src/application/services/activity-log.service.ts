import type { StoragePort } from "@/application/ports/storage";
import type {
  ActivityLogEntry,
  ActivityLogStorage,
  ActivityFilters,
} from "@/domain/types";

/** Default maximum entries in activity log */
const DEFAULT_MAX_ENTRIES = 50;

/** Storage key for activity log */
const ACTIVITY_LOG_KEY = "activityLog";

/**
 * ActivityLogService manages persistent activity log with ring buffer
 *
 * Records signing approvals and denials with timestamp, origin, kind, and decision.
 * Maintains a configurable ring buffer (default 50 entries, max 500) that
 * automatically rotates when capacity is reached.
 *
 * Storage: browser.storage.local under key "activityLog"
 * Format: { __version: "activityLog.v1", maxEntries: number, entries: ActivityLogEntry[] }
 */
export class ActivityLogService {
  private entries: ActivityLogEntry[] = [];
  private maxEntries: number;

  private initPromise: Promise<void>;

  constructor(
    private readonly storage: StoragePort,
    maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {
    this.maxEntries = Math.min(Math.max(maxEntries, 10), 500); // Clamp 10-500
    this.initPromise = this.loadFromStorage();
  }

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Add a new activity entry to the log
   * @param entry - Entry data without id and timestamp (auto-generated)
   */
  async addEntry(
    entry: Omit<ActivityLogEntry, "id" | "timestamp">
  ): Promise<void> {
    await this.ensureInitialized();

    const newEntry: ActivityLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Math.floor(Date.now() / 1000),
      ...entry,
    };

    // Insert at beginning (newest first)
    this.entries.unshift(newEntry);

    // Rotate if exceeds max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }

    await this.saveToStorage();
  }

  /**
   * Get recent entries with pagination
   * @param limit - Maximum number of entries to return (default 10)
   * @param offset - Number of entries to skip (default 0)
   * @returns Array of entries ordered newest first
   */
  async getRecent(
    limit: number = 10,
    offset: number = 0
  ): Promise<ActivityLogEntry[]> {
    await this.ensureInitialized();

    const safeLimit = Math.max(1, Math.min(limit, 100)); // Clamp 1-100
    const safeOffset = Math.max(0, offset);

    return this.entries.slice(safeOffset, safeOffset + safeLimit);
  }

  /**
   * Filter entries by origin and/or kind with pagination
   * @param filters - Filter criteria and pagination params
   * @returns Filtered entries ordered newest first
   */
  async filterBy(filters: ActivityFilters): Promise<ActivityLogEntry[]> {
    await this.ensureInitialized();

    let filtered = this.entries;

    // Apply origin filter
    if (filters.origin) {
      filtered = filtered.filter((e) => e.origin === filters.origin);
    }

    // Apply kind filter
    if (filters.kind !== undefined) {
      filtered = filtered.filter((e) => e.kind === filters.kind);
    }

    // Apply pagination
    const limit = Math.max(1, Math.min(filters.limit || 10, 100));
    const offset = Math.max(0, filters.offset || 0);

    return filtered.slice(offset, offset + limit);
  }

  /**
   * Get total count of entries (for pagination UI)
   * @param filters - Optional filters to count subset
   * @returns Total number of entries matching filters
   */
  async count(
    filters?: Pick<ActivityFilters, "origin" | "kind">
  ): Promise<number> {
    await this.ensureInitialized();

    if (!filters) {
      return this.entries.length;
    }

    let filtered = this.entries;

    if (filters.origin) {
      filtered = filtered.filter((e) => e.origin === filters.origin);
    }

    if (filters.kind !== undefined) {
      filtered = filtered.filter((e) => e.kind === filters.kind);
    }

    return filtered.length;
  }

  /**
   * Get all unique origins from current entries (for filter dropdown)
   * @returns Array of unique origin URLs
   */
  async getUniqueOrigins(): Promise<string[]> {
    await this.ensureInitialized();

    const origins = new Set(this.entries.map((e) => e.origin));
    return Array.from(origins).sort();
  }

  /**
   * Clear all activity log entries
   */
  async clearAll(): Promise<void> {
    await this.ensureInitialized();

    this.entries = [];
    await this.saveToStorage();
  }

  /**
   * Update maximum entries limit
   * @param max - New maximum (clamped to 10-500)
   */
  async setMaxEntries(max: number): Promise<void> {
    await this.ensureInitialized();

    this.maxEntries = Math.min(Math.max(max, 10), 500);

    // Truncate if current entries exceed new max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }

    // Persist new max (even if no truncation occurred)
    await this.saveToStorage();
  }

  /**
   * Load activity log from storage on initialization
   */
  private async loadFromStorage(): Promise<void> {
    try {
      const data = await this.storage.get<ActivityLogStorage>(ACTIVITY_LOG_KEY);

      if (data && data.__version === "activityLog.v1") {
        this.entries = data.entries || [];
        this.maxEntries = data.maxEntries || DEFAULT_MAX_ENTRIES;

        // Ensure maxEntries is within valid range
        this.maxEntries = Math.min(Math.max(this.maxEntries, 10), 500);

        // Truncate if entries exceed max
        if (this.entries.length > this.maxEntries) {
          this.entries = this.entries.slice(0, this.maxEntries);
        }
      }
    } catch (error) {
      console.error("Failed to load activity log from storage:", error);
      // Initialize with empty log on error
      this.entries = [];
    }
  }

  /**
   * Save current activity log to storage
   */
  private async saveToStorage(): Promise<void> {
    try {
      const data: ActivityLogStorage = {
        __version: "activityLog.v1",
        maxEntries: this.maxEntries,
        entries: this.entries,
      };

      await this.storage.set(ACTIVITY_LOG_KEY, data);
    } catch (error) {
      console.error("Failed to save activity log to storage:", error);
    }
  }
}

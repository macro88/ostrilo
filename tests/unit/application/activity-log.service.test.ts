import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActivityLogService } from "@/application/services/activity-log.service";
import type { StoragePort } from "@/application/ports/storage";
import type { ActivityLogEntry, ActivityLogStorage } from "@/domain/types";

class MockStorage implements StoragePort {
  private store: Map<string, any> = new Map();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("ActivityLogService", () => {
  let storage: MockStorage;
  let service: ActivityLogService;

  beforeEach(() => {
    storage = new MockStorage();
    service = new ActivityLogService(storage);
  });

  it("should initialize with empty entries if storage is empty", async () => {
    const entries = await service.getRecent();
    expect(entries).toEqual([]);
  });

  it("should add an entry to the log", async () => {
    const entryData = {
      origin: "https://example.com",
      kind: 1,
      decision: "allow" as const,
      contentPreview: "Test event",
    };

    await service.addEntry(entryData);

    const entries = await service.getRecent();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject(entryData);
    expect(entries[0].id).toBeDefined();
    expect(entries[0].timestamp).toBeDefined();
  });

  it("should rotate entries when max capacity is reached", async () => {
    // Initialize with maxEntries = 3
    service = new ActivityLogService(storage, 3);

    // Add 4 entries
    for (let i = 1; i <= 4; i++) {
      await service.addEntry({
        origin: "https://example.com",
        kind: 1,
        decision: "allow",
        contentPreview: `Event ${i}`,
      });
    }

    const entries = await service.getRecent();
    expect(entries).toHaveLength(3);
    // Should contain Event 4, 3, 2 (newest first)
    expect(entries[0].contentPreview).toBe("Event 4");
    expect(entries[2].contentPreview).toBe("Event 2");
  });

  it("should filter entries by origin", async () => {
    await service.addEntry({
      origin: "https://example.com",
      kind: 1,
      decision: "allow",
    });
    await service.addEntry({
      origin: "https://other.com",
      kind: 1,
      decision: "allow",
    });

    const filtered = await service.filterBy({ origin: "https://example.com" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].origin).toBe("https://example.com");
  });

  it("should filter entries by kind", async () => {
    await service.addEntry({
      origin: "https://example.com",
      kind: 1,
      decision: "allow",
    });
    await service.addEntry({
      origin: "https://example.com",
      kind: 2,
      decision: "allow",
    });

    const filtered = await service.filterBy({ kind: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].kind).toBe(1);
  });

  it("should support pagination", async () => {
    for (let i = 1; i <= 5; i++) {
      await service.addEntry({
        origin: "https://example.com",
        kind: 1,
        decision: "allow",
        contentPreview: `Event ${i}`,
      });
    }

    // Get first page (limit 2)
    const page1 = await service.getRecent(2, 0);
    expect(page1).toHaveLength(2);
    expect(page1[0].contentPreview).toBe("Event 5");
    expect(page1[1].contentPreview).toBe("Event 4");

    // Get second page (limit 2, offset 2)
    const page2 = await service.getRecent(2, 2);
    expect(page2).toHaveLength(2);
    expect(page2[0].contentPreview).toBe("Event 3");
    expect(page2[1].contentPreview).toBe("Event 2");
  });

  it("should clear all entries", async () => {
    await service.addEntry({
      origin: "https://example.com",
      kind: 1,
      decision: "allow",
    });

    await service.clearAll();

    const entries = await service.getRecent();
    expect(entries).toEqual([]);
  });

  it("should initialize from existing storage", async () => {
    const existingEntries: ActivityLogEntry[] = [
      {
        id: "1",
        timestamp: 1234567890,
        origin: "https://stored.com",
        kind: 1,
        decision: "allow",
      },
    ];

    const storedData: ActivityLogStorage = {
      __version: "activityLog.v1",
      maxEntries: 50,
      entries: existingEntries,
    };

    await storage.set("activityLog", storedData);

    // Create new service instance
    const newService = new ActivityLogService(storage);
    const entries = await newService.getRecent();

    expect(entries).toHaveLength(1);
    expect(entries[0].origin).toBe("https://stored.com");
  });
});

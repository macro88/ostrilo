import { beforeEach, describe, expect, it } from "vitest";
import {
  DISCLOSURE_RATE_LIMITS,
  DISCLOSURE_WINDOW_STORAGE_KEY,
  DisclosureRateLimitService,
} from "@/application/services/disclosure-rate-limit.service";
import {
  ApprovalQueueService,
  ApprovalRateLimitError,
  ENQUEUE_WINDOW_STORAGE_KEY,
  QUEUE_LIMITS,
} from "@/application/services/approval-queue.service";
import { AUTO_SIGN_WINDOW_STORAGE_KEY } from "@/application/services/auto-sign-budget.service";
import type { StoragePort } from "@/application/ports/storage";
import type { UnsignedEvent } from "@/domain/types";

const A = "https://a.example";

function memoryPort(): StoragePort & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      map.set(key, structuredClone(value));
    },
    async remove(key: string) {
      map.delete(key);
    },
  };
}

const event = (n: number): UnsignedEvent => ({
  kind: 1,
  content: `note ${n}`,
  tags: [],
  created_at: 1_700_000_000 + n,
});

describe("the three persisted windows do not share a record", () => {
  it("uses distinct storage keys", () => {
    const keys = [
      DISCLOSURE_WINDOW_STORAGE_KEY,
      ENQUEUE_WINDOW_STORAGE_KEY,
      AUTO_SIGN_WINDOW_STORAGE_KEY,
    ];
    expect(new Set(keys).size).toBe(keys.length);
    // None of them may be the lock record, which belongs to the vault.
    expect(keys).not.toContain("lockState");
  });
});

describe("DisclosureRateLimitService across a worker restart", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 9_000_000;
  });

  it("does not hand an origin a fresh allowance after the worker is evicted", async () => {
    const storage = memoryPort();
    const before = new DisclosureRateLimitService(now, storage);
    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow; i++) {
      expect(before.tryConsume(A)).toBe(true);
    }
    await before.settled();

    const after = new DisclosureRateLimitService(now, storage);
    await after.ready();

    expect(after.tryConsume(A)).toBe(false);
  });

  it("lets the allowance recover on the original schedule", async () => {
    const storage = memoryPort();
    const before = new DisclosureRateLimitService(now, storage);
    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow; i++) {
      before.tryConsume(A);
    }
    await before.settled();

    clock += DISCLOSURE_RATE_LIMITS.windowMs;
    const after = new DisclosureRateLimitService(now, storage);
    await after.ready();

    expect(after.tryConsume(A)).toBe(true);
  });

  it("treats a malformed record as an empty window", async () => {
    const storage = memoryPort();
    storage.map.set(DISCLOSURE_WINDOW_STORAGE_KEY, { v: 1, origins: 7 });
    const limiter = new DisclosureRateLimitService(now, storage);
    await limiter.ready();

    for (let i = 0; i < DISCLOSURE_RATE_LIMITS.perOriginPerWindow; i++) {
      expect(limiter.tryConsume(A)).toBe(true);
    }
    expect(limiter.tryConsume(A)).toBe(false);
  });
});

describe("ApprovalQueueService across a worker restart", () => {
  function fill(queue: ApprovalQueueService, count: number) {
    for (let i = 0; i < count; i++) {
      const request = queue.enqueue(A, event(i), () => {});
      queue.resolve(request.id, "deny");
    }
  }

  it("keeps an origin's enqueue window, so the 11th request in a minute is still refused", async () => {
    const storage = memoryPort();
    const before = new ApprovalQueueService(60_000, storage);
    fill(before, QUEUE_LIMITS.perOriginPerWindow);
    await before.settled();
    before.clear();

    const after = new ApprovalQueueService(60_000, storage);
    await after.ready();

    expect(() => after.enqueue(A, event(99), () => {})).toThrow(
      ApprovalRateLimitError
    );
    after.clear();
  });

  it("does not carry pending entries across, which cannot be resolved without their callers", async () => {
    const storage = memoryPort();
    const before = new ApprovalQueueService(60_000, storage);
    before.enqueue(A, event(1), () => {});
    await before.settled();

    const after = new ApprovalQueueService(60_000, storage);
    await after.ready();

    expect(after.count()).toBe(0);
    before.clear();
  });

  it("does not charge a de-duplicated request, in memory or in the stored window", async () => {
    const storage = memoryPort();
    const queue = new ApprovalQueueService(60_000, storage);
    queue.enqueue(A, event(1), () => {}, "hash-1");
    queue.enqueue(A, event(1), () => {}, "hash-1");
    await queue.settled();

    const stored = storage.map.get(ENQUEUE_WINDOW_STORAGE_KEY) as {
      origins: Record<string, number[]>;
    };
    expect(stored.origins[A]).toHaveLength(1);
    queue.clear();
  });

  it("treats a malformed record as an empty window", async () => {
    const storage = memoryPort();
    storage.map.set(ENQUEUE_WINDOW_STORAGE_KEY, ["junk"]);
    const queue = new ApprovalQueueService(60_000, storage);
    await queue.ready();

    expect(() => queue.enqueue(A, event(1), () => {})).not.toThrow();
    queue.clear();
  });
});

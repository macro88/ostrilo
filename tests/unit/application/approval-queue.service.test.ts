import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ApprovalQueueService,
  RequestResolver,
} from "@/application/services/approval-queue.service";
import type {
  UnsignedEvent,
  ApprovalDecision,
  ApprovalAction,
} from "@/domain/types";

// Mock event for testing
const mockEvent: UnsignedEvent = {
  kind: 1,
  content: "Hello Nostr!",
  tags: [],
  created_at: Math.floor(Date.now() / 1000),
};

describe("ApprovalQueueService", () => {
  let queue: ApprovalQueueService;

  beforeEach(() => {
    vi.useFakeTimers();
    // Use a 1 second timeout for faster testing
    queue = new ApprovalQueueService(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("enqueue", () => {
    it("creates a pending request with unique ID", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      expect(request.id).toBeDefined();
      expect(request.id.length).toBeGreaterThan(0);
      expect(request.origin).toBe("https://example.com");
      expect(request.event).toBe(mockEvent);
      expect(request.createdAt).toBeDefined();
      expect(request.timeoutAt).toBeDefined();
    });

    it("sets correct timeout timestamp", () => {
      const resolver = vi.fn();
      const now = Math.floor(Date.now() / 1000);
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      // Timeout should be ~1 second from now (within tolerance)
      expect(request.timeoutAt).toBeGreaterThanOrEqual(now);
      expect(request.timeoutAt).toBeLessThanOrEqual(now + 2);
    });

    it("increments count when requests are added", () => {
      const resolver = vi.fn();
      expect(queue.count()).toBe(0);

      queue.enqueue("https://example.com", mockEvent, resolver);
      expect(queue.count()).toBe(1);

      queue.enqueue("https://example2.com", mockEvent, resolver);
      expect(queue.count()).toBe(2);
    });
  });

  describe("getNextPending", () => {
    it("returns undefined when queue is empty", () => {
      expect(queue.getNextPending()).toBeUndefined();
    });

    it("returns oldest request first (FIFO)", () => {
      const resolver = vi.fn();
      const request1 = queue.enqueue("https://first.com", mockEvent, resolver);
      const request2 = queue.enqueue("https://second.com", mockEvent, resolver);

      expect(queue.getNextPending()?.id).toBe(request1.id);
    });

    it("does not remove the request from queue", () => {
      const resolver = vi.fn();
      queue.enqueue("https://example.com", mockEvent, resolver);

      queue.getNextPending();
      expect(queue.count()).toBe(1);
    });
  });

  describe("getById", () => {
    it("returns undefined for non-existent ID", () => {
      expect(queue.getById("non-existent-id")).toBeUndefined();
    });

    it("returns request for valid ID", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      const found = queue.getById(request.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(request.id);
    });
  });

  describe("resolve", () => {
    it("returns false for non-existent request", () => {
      const result = queue.resolve("non-existent-id", "allow");
      expect(result).toBe(false);
    });

    it("returns true and calls resolver for valid request", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      const result = queue.resolve(request.id, "allow");

      expect(result).toBe(true);
      expect(resolver).toHaveBeenCalledWith("allow", "allow");
    });

    it("removes request from queue after resolve", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);
      expect(queue.count()).toBe(1);

      queue.resolve(request.id, "allow");
      expect(queue.count()).toBe(0);
    });

    it("maps allow_once action to allow decision", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      queue.resolve(request.id, "allow_once");

      expect(resolver).toHaveBeenCalledWith("allow", "allow_once");
    });

    it("maps deny action to deny decision", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      queue.resolve(request.id, "deny");

      expect(resolver).toHaveBeenCalledWith("deny", "deny");
    });

    it("maps deny_remember action to deny decision", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      queue.resolve(request.id, "deny_remember");

      expect(resolver).toHaveBeenCalledWith("deny", "deny_remember");
    });

    it("prevents double-resolve of same request", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      queue.resolve(request.id, "allow");
      const secondResult = queue.resolve(request.id, "deny");

      expect(secondResult).toBe(false);
      expect(resolver).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout behavior", () => {
    it("auto-denies request after timeout", async () => {
      const resolver = vi.fn();
      queue.enqueue("https://example.com", mockEvent, resolver);

      expect(resolver).not.toHaveBeenCalled();

      // Advance time past timeout
      vi.advanceTimersByTime(1100);

      expect(resolver).toHaveBeenCalledWith("deny", "deny");
      expect(queue.count()).toBe(0);
    });

    it("does not timeout if resolved before timeout", () => {
      const resolver = vi.fn();
      const request = queue.enqueue("https://example.com", mockEvent, resolver);

      // Advance time but not past timeout
      vi.advanceTimersByTime(500);

      // Resolve before timeout
      queue.resolve(request.id, "allow");

      // Advance time past original timeout
      vi.advanceTimersByTime(1000);

      // Should only be called once (from resolve, not timeout)
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(resolver).toHaveBeenCalledWith("allow", "allow");
    });
  });

  describe("hasPending", () => {
    it("returns false when queue is empty", () => {
      expect(queue.hasPending()).toBe(false);
    });

    it("returns true when queue has requests", () => {
      const resolver = vi.fn();
      queue.enqueue("https://example.com", mockEvent, resolver);
      expect(queue.hasPending()).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears all pending requests", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      queue.enqueue("https://first.com", mockEvent, resolver1);
      queue.enqueue("https://second.com", mockEvent, resolver2);

      expect(queue.count()).toBe(2);

      queue.clear();

      expect(queue.count()).toBe(0);
    });

    it("calls resolver with deny for all cleared requests", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      queue.enqueue("https://first.com", mockEvent, resolver1);
      queue.enqueue("https://second.com", mockEvent, resolver2);

      queue.clear();

      expect(resolver1).toHaveBeenCalledWith("deny", "deny");
      expect(resolver2).toHaveBeenCalledWith("deny", "deny");
    });
  });

  describe("event ID de-duplication", () => {
    it("returns same request for duplicate event ID hash", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "abc123hash";

      const request1 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      const request2 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      // Should return the same request instance
      expect(request2.id).toBe(request1.id);
      expect(request1.eventIdHash).toBe(eventIdHash);
      expect(queue.count()).toBe(1);
    });

    it("resolves every caller attached to a duplicate event ID hash", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "abc123hash";

      const request1 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      const request2 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      queue.resolve(request1.id, "allow_once");

      expect(request2.id).toBe(request1.id);
      expect(resolver1).toHaveBeenCalledWith("allow", "allow_once");
      expect(resolver2).toHaveBeenCalledWith("allow", "allow_once");
    });

    it("creates separate entries for different event ID hashes", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();

      const request1 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver1,
        "hash1"
      );
      const request2 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver2,
        "hash2"
      );

      expect(request1.id).not.toBe(request2.id);
      expect(queue.count()).toBe(2);
    });

    it("gives two origins requesting an identical event two separate entries", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "same-event-hash";

      const request1 = queue.enqueue(
        "https://origin1.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      const request2 = queue.enqueue(
        "https://origin2.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      // An approval prompt is a statement about one site. Sharing the entry
      // means a click the user believed applied to origin1 also releases a
      // signature to origin2.
      expect(request2.id).not.toBe(request1.id);
      expect(request1.origin).toBe("https://origin1.com");
      expect(request2.origin).toBe("https://origin2.com");
      expect(queue.count()).toBe(2);
    });

    it("resolving one origin's approval does not resolve another origin's", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "same-event-hash";

      const request1 = queue.enqueue(
        "https://origin1.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      const request2 = queue.enqueue(
        "https://origin2.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      queue.resolve(request1.id, "allow");

      expect(resolver1).toHaveBeenCalledWith("allow", "allow");
      expect(resolver2).not.toHaveBeenCalled();
      expect(queue.getById(request2.id)).toBeDefined();
      expect(queue.count()).toBe(1);
    });

    it("still collapses one origin repeating the same request into one entry", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "same-event-hash";

      const request1 = queue.enqueue(
        "https://origin1.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      const request2 = queue.enqueue(
        "https://origin1.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      // A double-clicked button must not produce two prompts, but both pending
      // promises still need a result.
      expect(request2.id).toBe(request1.id);
      expect(queue.count()).toBe(1);

      queue.resolve(request1.id, "allow_once");
      expect(resolver1).toHaveBeenCalledWith("allow", "allow_once");
      expect(resolver2).toHaveBeenCalledWith("allow", "allow_once");
    });

    it("times out every caller attached to a duplicate event ID hash", () => {
      const resolver1 = vi.fn();
      const resolver2 = vi.fn();
      const eventIdHash = "same-event-hash";

      const request = queue.enqueue(
        "https://origin1.com",
        mockEvent,
        resolver1,
        eventIdHash
      );
      queue.enqueue("https://origin1.com", mockEvent, resolver2, eventIdHash);

      vi.advanceTimersByTime(1000);

      expect(queue.wasTimeout(request.id)).toBe(true);
      expect(resolver1).toHaveBeenCalledWith("deny", "deny");
      expect(resolver2).toHaveBeenCalledWith("deny", "deny");
    });

    it("clears event ID mapping after resolution", () => {
      const resolver = vi.fn();
      const eventIdHash = "event-hash";

      const request = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver,
        eventIdHash
      );

      // Resolve the request
      queue.resolve(request.id, "allow_once");

      // Now the same event hash should create a new entry
      const resolver2 = vi.fn();
      const request2 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      expect(request2.id).not.toBe(request.id);
    });

    it("clears event ID mapping on timeout", () => {
      const resolver = vi.fn();
      const eventIdHash = "event-hash";

      queue.enqueue("https://example.com", mockEvent, resolver, eventIdHash);

      // Advance time to trigger timeout
      vi.advanceTimersByTime(1000);

      // Now the same event hash should create a new entry
      const resolver2 = vi.fn();
      const request2 = queue.enqueue(
        "https://example.com",
        mockEvent,
        resolver2,
        eventIdHash
      );

      expect(queue.count()).toBe(1);
      expect(resolver).toHaveBeenCalledWith("deny", "deny");
    });

    it("getAllPending returns all requests in FIFO order", () => {
      const resolver = vi.fn();
      const request1 = queue.enqueue("https://first.com", mockEvent, resolver);
      const request2 = queue.enqueue("https://second.com", mockEvent, resolver);
      const request3 = queue.enqueue("https://third.com", mockEvent, resolver);

      const allPending = queue.getAllPending();

      expect(allPending).toHaveLength(3);
      expect(allPending[0].id).toBe(request1.id);
      expect(allPending[1].id).toBe(request2.id);
      expect(allPending[2].id).toBe(request3.id);
    });

    it("keys the de-duplication map per origin, not globally", () => {
      const resolver = vi.fn();
      const eventIdHash = "shared-hash";

      queue.enqueue("https://a.example", mockEvent, resolver, eventIdHash);
      queue.enqueue("https://b.example", mockEvent, resolver, eventIdHash);

      // Both entries are tracked; the map is not collapsing them by hash.
      expect(queue.getQueuedEventIds()).toEqual([eventIdHash, eventIdHash]);
      expect(queue.count()).toBe(2);
    });

    it("frees the origin-scoped key after resolution", () => {
      const resolver = vi.fn();
      const eventIdHash = "reused-hash";

      const first = queue.enqueue(
        "https://a.example",
        mockEvent,
        resolver,
        eventIdHash
      );
      queue.resolve(first.id, "allow_once");

      const second = queue.enqueue(
        "https://a.example",
        mockEvent,
        vi.fn(),
        eventIdHash
      );
      expect(second.id).not.toBe(first.id);
      expect(queue.count()).toBe(1);
    });

    it("getQueuedEventIds returns tracked event hashes", () => {
      const resolver = vi.fn();
      queue.enqueue("https://example.com", mockEvent, resolver, "hash1");
      queue.enqueue("https://example.com", mockEvent, resolver, "hash2");
      queue.enqueue("https://example.com", mockEvent, resolver); // No hash

      const eventIds = queue.getQueuedEventIds();

      expect(eventIds).toHaveLength(2);
      expect(eventIds).toContain("hash1");
      expect(eventIds).toContain("hash2");
    });
  });
});

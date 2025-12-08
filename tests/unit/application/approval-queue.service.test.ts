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
});

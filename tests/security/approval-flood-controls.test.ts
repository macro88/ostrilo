import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ApprovalQueueService,
  ApprovalRateLimitError,
  QUEUE_LIMITS,
} from "@/application/services/approval-queue.service";
import type { UnsignedEvent } from "@/domain/types";

/**
 * Flood controls on the approval queue.
 *
 * There were none. A page could enqueue approval prompts as fast as it could
 * call `signEvent`, and each one opened or refreshed an approval window. That
 * is denial of service against the user's own browser, and it is also the
 * setup for approval fatigue: the reliable way to get a signature a user did
 * not mean to give is to ask a hundred times and hope one click lands.
 *
 * The limits are PER ORIGIN as well as global, because one hostile site must
 * not be able to fill the queue and lock out a legitimate one.
 */

const ORIGIN = "https://flood.example";
const OTHER = "https://legit.example";

function event(content: string): UnsignedEvent {
  return {
    kind: 1,
    content,
    tags: [],
    created_at: 1_735_689_600,
  } as UnsignedEvent;
}

describe("approval flood controls", () => {
  let queue: ApprovalQueueService;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new ApprovalQueueService();
  });

  afterEach(() => {
    queue.clear();
    vi.useRealTimers();
  });

  const enqueue = (origin: string, content: string, hash?: string) =>
    queue.enqueue(origin, event(content), () => {}, hash);

  it("caps how many requests one origin may have pending", () => {
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      enqueue(ORIGIN, `note ${i}`);
    }

    expect(() => enqueue(ORIGIN, "one too many")).toThrow(
      ApprovalRateLimitError
    );
    expect(queue.count()).toBe(QUEUE_LIMITS.perOriginPending);
  });

  it("does not let one origin lock out another", () => {
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      enqueue(ORIGIN, `note ${i}`);
    }

    // A different site is unaffected by the first one's flood.
    expect(() => enqueue(OTHER, "a legitimate request")).not.toThrow();
  });

  it("caps the queue globally", () => {
    const origins = Array.from(
      { length: 10 },
      (_, i) => `https://site-${i}.example`
    );
    let enqueued = 0;
    try {
      for (const origin of origins) {
        for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
          enqueue(origin, `note ${i}`);
          enqueued++;
        }
      }
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalRateLimitError);
    }

    expect(enqueued).toBe(QUEUE_LIMITS.globalPending);
    expect(queue.count()).toBe(QUEUE_LIMITS.globalPending);
  });

  it("rate-limits an origin that resolves and immediately re-asks", () => {
    // Capacity alone is not enough: a site that gets a decision and instantly
    // asks again can keep the queue shallow and still produce a hundred
    // prompts a minute.
    let allowed = 0;
    try {
      for (let i = 0; i < QUEUE_LIMITS.perOriginPerWindow + 5; i++) {
        const request = enqueue(ORIGIN, `note ${i}`);
        allowed++;
        queue.resolve(request.id, "deny");
      }
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalRateLimitError);
    }

    expect(
      allowed,
      "SECURITY REGRESSION: an origin enqueued past its rolling allowance"
    ).toBe(QUEUE_LIMITS.perOriginPerWindow);
  });

  it("lets the allowance recover once the window passes", () => {
    for (let i = 0; i < QUEUE_LIMITS.perOriginPerWindow; i++) {
      const request = enqueue(ORIGIN, `note ${i}`);
      queue.resolve(request.id, "deny");
    }
    expect(() => enqueue(ORIGIN, "blocked")).toThrow(ApprovalRateLimitError);

    vi.advanceTimersByTime(QUEUE_LIMITS.windowMs + 1);

    expect(() => enqueue(ORIGIN, "allowed again")).not.toThrow();
  });

  it("releases capacity when a request is resolved", () => {
    const requests = [];
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      requests.push(enqueue(ORIGIN, `note ${i}`));
    }
    expect(() => enqueue(ORIGIN, "full")).toThrow();

    queue.resolve(requests[0].id, "deny");

    expect(() => enqueue(ORIGIN, "room again")).not.toThrow();
  });

  it("releases capacity when a request times out", () => {
    const requests = [];
    for (let i = 0; i < QUEUE_LIMITS.perOriginPending; i++) {
      requests.push(enqueue(ORIGIN, `note ${i}`));
    }
    expect(() => enqueue(ORIGIN, "full")).toThrow();

    // Let every entry hit its own deadline.
    vi.advanceTimersByTime(120_000);

    expect(queue.count()).toBe(0);
    expect(() => enqueue(ORIGIN, "room again")).not.toThrow();
    void requests;
  });

  it("does not charge a de-duplicated enqueue against the allowance", () => {
    // Collapsing a double-clicked button into one prompt must not cost the
    // page the same as asking twice.
    const hash = "ab".repeat(32);
    for (let i = 0; i < QUEUE_LIMITS.perOriginPerWindow + 3; i++) {
      expect(() => enqueue(ORIGIN, "same note", hash)).not.toThrow();
    }
    expect(queue.count()).toBe(1);
  });
});

describe("cancelling an abandoned request", () => {
  let queue: ApprovalQueueService;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new ApprovalQueueService();
  });

  afterEach(() => {
    queue.clear();
    vi.useRealTimers();
  });

  it("resolves the page's own request as denied", () => {
    let decision: string | undefined;
    const request = queue.enqueue(
      ORIGIN,
      event("abandoned"),
      (d) => {
        decision = d;
      },
      undefined,
      { clientRequestId: "client-1" }
    );

    expect(queue.cancelByClientRequestId(ORIGIN, "client-1")).toBe(true);
    expect(decision).toBe("deny");
    expect(queue.getById(request.id)).toBeUndefined();
  });

  it("can never resolve a request as approved", () => {
    // There is deliberately no approving counterpart. A page-reachable path
    // that resolved an approval as allowed would be a way to sign without
    // asking anyone.
    const decisions: string[] = [];
    queue.enqueue(
      ORIGIN,
      event("abandoned"),
      (d) => decisions.push(d),
      undefined,
      { clientRequestId: "client-1" }
    );

    queue.cancelByClientRequestId(ORIGIN, "client-1");

    expect(decisions).toEqual(["deny"]);
    expect(decisions).not.toContain("allow");
  });

  it("cannot cancel another origin's request", () => {
    let decision: string | undefined;
    queue.enqueue(
      ORIGIN,
      event("mine"),
      (d) => {
        decision = d;
      },
      undefined,
      { clientRequestId: "client-1" }
    );

    expect(
      queue.cancelByClientRequestId(OTHER, "client-1"),
      "SECURITY REGRESSION: one origin cancelled another's approval prompt"
    ).toBe(false);
    expect(decision).toBeUndefined();
    expect(queue.count()).toBe(1);
  });

  it("is a no-op for an unknown id", () => {
    expect(queue.cancelByClientRequestId(ORIGIN, "never-existed")).toBe(false);
  });
});

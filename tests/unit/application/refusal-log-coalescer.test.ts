import { describe, expect, it } from "vitest";
import { RefusalLogCoalescer } from "@/application/services/refusal-log-coalescer";
import { MAX_TRACKED_ORIGINS } from "@/application/services/rolling-window-counters";

describe("RefusalLogCoalescer", () => {
  it("lets an origin through once per window", () => {
    let now = 1_000;
    const coalescer = new RefusalLogCoalescer(60_000, () => now);

    expect(coalescer.shouldLog("https://a.example")).toBe(true);
    now += 59_999;
    expect(coalescer.shouldLog("https://a.example")).toBe(false);
    now += 1;
    expect(coalescer.shouldLog("https://a.example")).toBe(true);
  });

  it("tracks each origin separately", () => {
    const coalescer = new RefusalLogCoalescer(60_000, () => 0);

    expect(coalescer.shouldLog("https://a.example")).toBe(true);
    expect(coalescer.shouldLog("https://b.example")).toBe(true);
    expect(coalescer.shouldLog("https://a.example")).toBe(false);
  });

  it("stays bounded when a page cycles through origins, forgetting the quietest first", () => {
    let now = 0;
    const coalescer = new RefusalLogCoalescer(60_000, () => now++);

    for (let i = 0; i <= MAX_TRACKED_ORIGINS; i++) {
      coalescer.shouldLog(`https://site${i}.example`);
    }

    const tracked = (coalescer as unknown as { lastLoggedAt: Map<string, number> })
      .lastLoggedAt;
    expect(tracked.size).toBe(MAX_TRACKED_ORIGINS);
    expect(tracked.has("https://site0.example")).toBe(false);
    expect(tracked.has(`https://site${MAX_TRACKED_ORIGINS}.example`)).toBe(true);
  });
});

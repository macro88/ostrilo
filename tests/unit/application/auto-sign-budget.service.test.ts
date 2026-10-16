import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_SIGN_BUDGET,
  AUTO_SIGN_WINDOW_STORAGE_KEY,
  AutoSignBudgetService,
} from "@/application/services/auto-sign-budget.service";
import type { StoragePort } from "@/application/ports/storage";

const A = "https://a.example";
const B = "https://b.example";

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

describe("AutoSignBudgetService", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 5_000_000;
  });

  it("is 60 per rolling 60 seconds", () => {
    expect(AUTO_SIGN_BUDGET.perOriginPerWindow).toBe(60);
    expect(AUTO_SIGN_BUDGET.windowMs).toBe(60_000);
  });

  describe("the boundary", () => {
    it("allows the 60th request and refuses the 61st", () => {
      const budget = new AutoSignBudgetService(now);

      for (let i = 1; i <= 60; i++) {
        expect(budget.tryConsume(A), `request ${i}`).toBe(true);
      }
      expect(budget.tryConsume(A)).toBe(false);
    });

    it("charges nothing for a refused request", () => {
      const budget = new AutoSignBudgetService(now);
      for (let i = 0; i < 60; i++) budget.tryConsume(A);
      for (let i = 0; i < 10; i++) expect(budget.tryConsume(A)).toBe(false);

      clock += AUTO_SIGN_BUDGET.windowMs;

      // The refusals above did not extend the window: it is exactly free.
      expect(budget.tryConsume(A)).toBe(true);
    });

    it("meters origins independently", () => {
      const budget = new AutoSignBudgetService(now);
      for (let i = 0; i < 60; i++) budget.tryConsume(A);

      expect(budget.tryConsume(A)).toBe(false);
      expect(budget.tryConsume(B)).toBe(true);
    });
  });

  describe("roll-off", () => {
    it("frees one slot as the oldest request leaves the window", () => {
      const budget = new AutoSignBudgetService(now);
      budget.tryConsume(A);
      clock += 1_000;
      for (let i = 0; i < 59; i++) budget.tryConsume(A);
      expect(budget.tryConsume(A)).toBe(false);

      clock += AUTO_SIGN_BUDGET.windowMs - 1_000;

      expect(budget.tryConsume(A)).toBe(true);
      expect(budget.tryConsume(A)).toBe(false);
    });

    it("restores the whole budget after a quiet minute", () => {
      const budget = new AutoSignBudgetService(now);
      for (let i = 0; i < 60; i++) budget.tryConsume(A);

      clock += AUTO_SIGN_BUDGET.windowMs;

      for (let i = 0; i < 60; i++) expect(budget.tryConsume(A)).toBe(true);
      expect(budget.tryConsume(A)).toBe(false);
    });

    it("is still exhausted one millisecond before the window ends", () => {
      const budget = new AutoSignBudgetService(now);
      for (let i = 0; i < 60; i++) budget.tryConsume(A);

      clock += AUTO_SIGN_BUDGET.windowMs - 1;

      expect(budget.tryConsume(A)).toBe(false);
    });
  });

  describe("across a worker restart", () => {
    it("remembers an exhausted budget", async () => {
      const storage = memoryPort();
      const before = new AutoSignBudgetService(now, storage);
      for (let i = 0; i < 60; i++) before.tryConsume(A);
      await before.settled();

      const after = new AutoSignBudgetService(now, storage);
      await after.ready();

      expect(after.tryConsume(A)).toBe(false);
      expect(after.tryConsume(B)).toBe(true);
    });

    it("remembers a partly spent budget exactly", async () => {
      const storage = memoryPort();
      const before = new AutoSignBudgetService(now, storage);
      for (let i = 0; i < 45; i++) before.tryConsume(A);
      await before.settled();

      const after = new AutoSignBudgetService(now, storage);
      await after.ready();

      for (let i = 0; i < 15; i++) expect(after.tryConsume(A)).toBe(true);
      expect(after.tryConsume(A)).toBe(false);
    });

    it("rolls off on the original schedule, not from the restart", async () => {
      const storage = memoryPort();
      const before = new AutoSignBudgetService(now, storage);
      for (let i = 0; i < 60; i++) before.tryConsume(A);
      await before.settled();

      clock += AUTO_SIGN_BUDGET.windowMs - 1;
      const after = new AutoSignBudgetService(now, storage);
      await after.ready();
      expect(after.tryConsume(A)).toBe(false);

      clock += 1;
      expect(after.tryConsume(A)).toBe(true);
    });

    it("uses a record of its own", async () => {
      const storage = memoryPort();
      const budget = new AutoSignBudgetService(now, storage);
      budget.tryConsume(A);
      await budget.settled();

      expect([...storage.map.keys()]).toEqual([AUTO_SIGN_WINDOW_STORAGE_KEY]);
    });
  });

  describe("malformed stored counters", () => {
    it.each([
      ["garbage", "garbage"],
      ["a wrong shape", { v: 1, origins: { [A]: { not: "a list" } } }],
      ["an oversized list", { v: 1, origins: { [A]: new Array(10_000).fill(5_000_000) } }],
    ])("%s is an empty window, not an unlimited one", async (_name, record) => {
      const storage = memoryPort();
      storage.map.set(AUTO_SIGN_WINDOW_STORAGE_KEY, record);
      const budget = new AutoSignBudgetService(now, storage);
      await budget.ready();

      // Empty window: the full budget is available, and it is still a budget.
      for (let i = 0; i < 60; i++) expect(budget.tryConsume(A)).toBe(true);
      expect(budget.tryConsume(A)).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import { LOCK_REASONS } from "@/domain/types";
import { describeLockReason } from "@/ui/lib/lock-reason";

describe("describeLockReason", () => {
  it("has a sentence for every reason the background can record", () => {
    for (const reason of LOCK_REASONS) {
      const line = describeLockReason(reason, 35);
      expect(line, reason).toMatch(/^[A-Z].*\.$/);
      expect(line, reason).not.toMatch(/!|undefined|_/);
    }
  });

  it("names the timeout, in the singular when it is one minute", () => {
    expect(describeLockReason("inactivity", 35)).toBe(
      "Locked after 35 minutes without activity."
    );
    expect(describeLockReason("inactivity", 1)).toBe(
      "Locked after 1 minute without activity."
    );
  });

  it("does not invent a timeout the background did not report", () => {
    for (const minutes of [undefined, 0, -3, Number.NaN]) {
      expect(describeLockReason("inactivity", minutes)).toBe(
        "Locked after a period without activity."
      );
    }
  });

  it("says the browser restarted the background for an evicted worker", () => {
    expect(describeLockReason("background_restarted")).toBe(
      "Locked because the browser restarted Ostrilo's background."
    );
  });
});

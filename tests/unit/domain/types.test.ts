import { describe, it, expect } from "vitest";
import {
  describeActivityAction,
  describeActivityEntry,
  getKindName,
} from "@/domain/types";

describe("getKindName", () => {
  it("returns the mapped name for a kind listed in the table", () => {
    expect(getKindName(0)).toBe("Profile Metadata");
    expect(getKindName(7000)).toBe("Job Feedback");
  });

  it.each([
    [1630, "Status"],
    [1633, "Status"],
    [5000, "Job Request"],
    [5999, "Job Request"],
    [6000, "Job Result"],
    [6999, "Job Result"],
    [9000, "Group Control Events"],
    [9030, "Group Control Events"],
    [39000, "Group metadata events"],
    [39009, "Group metadata events"],
  ])("names ranged kind %i as %s at the edge of its range", (kind, name) => {
    expect(getKindName(kind)).toBe(name);
  });

  it.each([1629, 1634, 4999, 9031, 38999, 39010, 65535])(
    "falls back to the numeric label for unlisted kind %i just outside every range",
    (kind) => {
      expect(getKindName(kind)).toBe(`Kind ${kind}`);
    }
  );
});

describe("describeActivityEntry", () => {
  it("titles an identity disclosure without consulting its kind", () => {
    expect(
      describeActivityEntry({ operation: "identity_disclosure", kind: 1 })
    ).toBe("Identity disclosure");
  });

  it("titles a signature by its event kind", () => {
    expect(describeActivityEntry({ operation: "sign_event", kind: 5500 })).toBe(
      "Job Request"
    );
  });

  it("treats a legacy entry with no operation as a signature", () => {
    expect(describeActivityEntry({ kind: 12345 })).toBe("Kind 12345");
  });

  it("says the request is unknown rather than printing an undefined kind", () => {
    expect(describeActivityEntry({ operation: "sign_event" })).toBe(
      "Unknown request"
    );
  });
});

describe("describeActivityAction", () => {
  it("phrases an allowed disclosure as sharing the public key", () => {
    expect(
      describeActivityAction({
        operation: "identity_disclosure",
        decision: "allow",
      })
    ).toBe("Shared your public key");
  });

  it("phrases a denied disclosure as a refusal", () => {
    expect(
      describeActivityAction({
        operation: "identity_disclosure",
        decision: "deny",
      })
    ).toBe("Refused to share your public key");
  });

  it("phrases an allowed signature with a lower-cased kind name", () => {
    expect(describeActivityAction({ kind: 6100, decision: "allow" })).toBe(
      "Signed job result"
    );
  });

  it("phrases a denied signature of an unknown request", () => {
    expect(
      describeActivityAction({ operation: "sign_event", decision: "deny" })
    ).toBe("Denied unknown request");
  });
});

describe("parseInactivityMinutes", () => {
  it("accepts whole minutes inside the auto-lock range", async () => {
    const { parseInactivityMinutes, AUTO_LOCK_BOUNDS } = await import("@/domain/types");
    expect(parseInactivityMinutes(AUTO_LOCK_BOUNDS.min)).toBe(AUTO_LOCK_BOUNDS.min);
    expect(parseInactivityMinutes(35)).toBe(35);
    expect(parseInactivityMinutes(AUTO_LOCK_BOUNDS.max)).toBe(AUTO_LOCK_BOUNDS.max);
  });

  it("drops everything else", async () => {
    const { parseInactivityMinutes } = await import("@/domain/types");
    for (const bad of [1.5, Infinity, -Infinity, NaN, 0, -1, 61, "35", null, undefined, {}]) {
      expect(parseInactivityMinutes(bad), String(bad)).toBeUndefined();
    }
  });
});

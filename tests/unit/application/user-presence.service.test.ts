import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  UserPresenceService,
  PRESENCE_LIMITS,
  type IdleState,
} from "@/application/services/user-presence.service";
import type { SettingsService } from "@/application/services/settings.service";
import { AUTO_LOCK_BOUNDS } from "@/domain/types";

/**
 * What is allowed to postpone the lock on behalf of a page.
 *
 * The service exists because two obvious answers are both wrong: counting only
 * extension clicks locks a user out while they read, and counting every
 * auto-signed request lets a pinned tab hold an unattended vault open forever.
 * These tests pin the third answer - the operating system's input recency - and
 * in particular pin the cases where it says no.
 */

function settingsStub(autoLockMinutes?: number): SettingsService {
  return {
    async get() {
      return { autoLockMinutes } as never;
    },
  } as unknown as SettingsService;
}

describe("presence gates activity from the signing path", () => {
  let clock: number;
  let record: Mock<() => Promise<void>>;

  beforeEach(() => {
    clock = 1_000_000;
    record = vi.fn(async () => {});
  });

  function service(state: IdleState | (() => Promise<IdleState>), minutes = 15) {
    const query = typeof state === "function" ? state : async () => state;
    return new UserPresenceService(settingsStub(minutes), query, () => clock);
  }

  it("records activity while the user is at the machine", async () => {
    const outcome = await service("active").recordIfPresent(record);
    expect(outcome).toBe("recorded");
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("records nothing while the user is idle", async () => {
    const outcome = await service("idle").recordIfPresent(record);
    expect(
      outcome,
      "an idle machine must not have its vault held open by a signing page"
    ).toBe("absent");
    expect(record).not.toHaveBeenCalled();
  });

  it("records nothing behind an operating-system lock", async () => {
    // Stronger than idle: the user did not stop typing, they shut the machine.
    const outcome = await service("locked").recordIfPresent(record);
    expect(outcome).toBe("absent");
    expect(record).not.toHaveBeenCalled();
  });

  it("treats a failed idle query as absence, not as presence", async () => {
    const outcome = await service(async () => {
      throw new Error("permission missing");
    }).recordIfPresent(record);
    expect(
      outcome,
      "SECURITY REGRESSION: a broken idle query must fail closed"
    ).toBe("absent");
    expect(record).not.toHaveBeenCalled();
  });

  it("treats an unrecognized idle state as absence", async () => {
    const outcome = await service(
      async () => "dozing" as unknown as IdleState
    ).recordIfPresent(record);
    expect(outcome).toBe("absent");
    expect(record).not.toHaveBeenCalled();
  });
});

describe("the detection interval is the inactivity window", () => {
  let seen: number[];

  function service(minutes: number | undefined) {
    seen = [];
    return new UserPresenceService(
      settingsStub(minutes),
      async (seconds) => {
        seen.push(seconds);
        return "active";
      },
      () => 1_000_000
    );
  }

  it("asks about the whole configured window, not the last few seconds", async () => {
    // A short interval asks "did they touch it just now?", which the user
    // reading a long post fails exactly as badly as counting only clicks did.
    await service(15).recordIfPresent(async () => {});
    expect(seen).toEqual([15 * 60]);
  });

  it("follows a changed timeout", async () => {
    await service(45).recordIfPresent(async () => {});
    expect(seen).toEqual([45 * 60]);
  });

  it("normalizes a stored zero rather than asking about no time at all", async () => {
    await service(0).recordIfPresent(async () => {});
    expect(seen).toEqual([AUTO_LOCK_BOUNDS.default * 60]);
  });

  it("never asks for less than the API floor", async () => {
    await service(undefined).recordIfPresent(async () => {});
    expect(seen[0]).toBeGreaterThanOrEqual(PRESENCE_LIMITS.minDetectionSeconds);
  });

  it("falls back to the default when settings cannot be read", async () => {
    const broken = {
      async get() {
        throw new Error("storage unavailable");
      },
    } as unknown as SettingsService;
    const queried: number[] = [];
    const svc = new UserPresenceService(
      broken,
      async (s) => {
        queried.push(s);
        return "active";
      },
      () => 1_000_000
    );
    expect(await svc.recordIfPresent(async () => {})).toBe("recorded");
    expect(queried).toEqual([AUTO_LOCK_BOUNDS.default * 60]);
  });
});

describe("the throttle bounds what a signing page can drive", () => {
  let clock: number;
  let queries: number;
  let record: Mock<() => Promise<void>>;
  let svc: UserPresenceService;

  beforeEach(() => {
    clock = 1_000_000;
    queries = 0;
    record = vi.fn(async () => {});
    svc = new UserPresenceService(
      settingsStub(15),
      async () => {
        queries++;
        return "active";
      },
      () => clock
    );
  });

  it("collapses a burst to one query and one write", async () => {
    for (let i = 0; i < 25; i++) await svc.recordIfPresent(record);
    expect(queries, "a page in a loop must not drive an idle query per event").toBe(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("reports the collapsed attempts as throttled, not as absent", async () => {
    await svc.recordIfPresent(record);
    expect(await svc.recordIfPresent(record)).toBe("throttled");
  });

  it("allows the next report once the window passes", async () => {
    await svc.recordIfPresent(record);
    clock += PRESENCE_LIMITS.throttleMs;
    expect(await svc.recordIfPresent(record)).toBe("recorded");
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("consumes the window on an absent attempt too", async () => {
    // Otherwise a page signing through an idle period drives an idle query per
    // event - the flood this throttle exists to stop, just with no write.
    let state: IdleState = "idle";
    let count = 0;
    const s = new UserPresenceService(
      settingsStub(15),
      async () => {
        count++;
        return state;
      },
      () => clock
    );
    expect(await s.recordIfPresent(record)).toBe("absent");
    state = "active";
    expect(await s.recordIfPresent(record)).toBe("throttled");
    expect(count).toBe(1);
    expect(record).not.toHaveBeenCalled();
  });

  it("stays well inside the shortest inactivity window it must not lose", async () => {
    // The throttle can delay a postponement by its own length. That must be
    // comfortably shorter than the smallest deadline it could otherwise miss.
    expect(PRESENCE_LIMITS.throttleMs).toBeLessThan(
      AUTO_LOCK_BOUNDS.min * 60 * 1000
    );
  });
});

/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoLockCountdown } from "@/components/common/AutoLockCountdown";
import { readCountdown } from "@/hooks/useAutoLockCountdown";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const sendMessage = vi.fn(async () => ({ ok: true, data: null }));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

let lockAt: number | undefined;
let autoLockMinutes = 15;

vi.mock("@/ui/features/authentication/hooks/useKeyManager", () => ({
  useKeyManager: () => ({ lockAt }),
}));

vi.mock("@/hooks/useAppSettings", () => ({
  useAppSettings: () => ({ settings: { autoLockMinutes } }),
}));

let container: HTMLDivElement;
let root: Root;

/** Mounts the countdown with the deadline `remainingMs` away from now. */
function mountWith(remainingMs: number | undefined, children?: React.ReactNode) {
  lockAt = remainingMs === undefined ? undefined : Date.now() + remainingMs;
  act(() => {
    root.render(<AutoLockCountdown size="lg">{children}</AutoLockCountdown>);
  });
}

function timer(): HTMLElement | null {
  return container.querySelector('[role="timer"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockClear();
  autoLockMinutes = 15;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("AutoLockCountdown display rules", () => {
  it("rounds minutes up, so the label is true when it reaches its value", () => {
    // A ring reading "0 min" for the last 59 seconds lies in the direction
    // that costs the user work.
    mountWith(90_000);
    expect(timer()?.textContent).toBe("2m");
    expect(timer()?.getAttribute("aria-label")).toBe("Vault locks in 2 minutes");
  });

  it("switches to seconds and the destructive role at or below a minute", () => {
    mountWith(45_000);
    expect(timer()?.textContent).toBe("45s");
    expect(timer()?.className).toContain("text-destructive");
    expect(timer()?.getAttribute("aria-label")).toBe(
      "Vault locks in 45 seconds"
    );
  });

  it("is not destructive above a minute", () => {
    mountWith(5 * 60_000);
    expect(timer()?.className).toContain("text-muted-foreground");
    expect(timer()?.className).not.toContain("text-destructive");
  });

  it("reads locked at the deadline and reports no negative time", () => {
    mountWith(0);
    expect(timer()?.textContent).toBe("Locked");
    expect(timer()?.getAttribute("aria-label")).toBe("Vault locked");
    expect(timer()?.textContent).not.toContain("-");
  });

  it("renders nothing at all when no deadline is available", () => {
    // Not a ring reading zero: the background said nothing, so neither does
    // the UI. This is also the older-background case.
    mountWith(undefined);
    expect(timer()).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("crosses from minutes to seconds as it ticks", () => {
    mountWith(61_000);
    expect(timer()?.textContent).toBe("2m");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(timer()?.textContent).toBe("59s");
    expect(timer()?.className).toContain("text-destructive");
  });

  it("reaches the locked reading by ticking, not by jumping negative", () => {
    mountWith(3_000);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(timer()?.textContent).toBe("Locked");
  });
});

describe("AutoLockCountdown accessibility contract", () => {
  it("is a timer that does not announce its updates", () => {
    mountWith(10 * 60_000);
    expect(timer()?.getAttribute("role")).toBe("timer");
    expect(timer()?.getAttribute("aria-live")).toBe("off");
  });

  it("hides the arc from assistive technology", () => {
    mountWith(10 * 60_000);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("refreshes the accessible name on every tick", () => {
    mountWith(30_000);
    expect(timer()?.getAttribute("aria-label")).toBe(
      "Vault locks in 30 seconds"
    );
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(timer()?.getAttribute("aria-label")).toBe(
      "Vault locks in 27 seconds"
    );
  });

  it("states the sub-minute time in words, not by colour alone", () => {
    mountWith(30_000);
    expect(timer()?.getAttribute("aria-label")).toContain("30 seconds");
  });

  it("steps the arc by default and eases it only when motion is welcome", () => {
    // The guard is inverted on purpose: reduced motion is the fallback, not
    // an exception someone has to remember to write.
    mountWith(10 * 60_000);
    const arc = container.querySelectorAll("circle")[1];
    expect(arc?.getAttribute("class")).toContain(
      "motion-safe:transition-[stroke-dashoffset]"
    );
    expect(arc?.getAttribute("class")).not.toContain("transition-none");
  });
});

describe("AutoLockCountdown is a readout, not a control", () => {
  it("issues no background request while it ticks", () => {
    mountWith(10 * 60_000);
    sendMessage.mockClear();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(
      sendMessage,
      "the countdown must not add traffic that could keep the MV3 worker alive"
    ).not.toHaveBeenCalled();
  });

  it("holds no interactive element of its own", () => {
    mountWith(10 * 60_000);
    expect(timer()?.querySelector("button")).toBeNull();
    expect(timer()?.getAttribute("tabindex")).toBeNull();
    expect(timer()?.getAttribute("onclick")).toBeNull();
  });

  it("leaves a control placed at its centre operable", () => {
    // The header case: the ring wraps the lock button rather than replacing
    // it, and the reading gives way to whatever occupies the centre.
    const onClick = vi.fn();
    mountWith(
      10 * 60_000,
      <button type="button" onClick={onClick}>
        Lock
      </button>
    );

    const button = timer()?.querySelector("button");
    expect(button).not.toBeNull();
    expect(timer()?.textContent).toBe("Lock");
    act(() => {
      button?.click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still renders the centre content when there is no deadline", () => {
    mountWith(
      undefined,
      <button type="button">
        Lock
      </button>
    );
    expect(timer()).toBeNull();
    expect(container.querySelector("button")).not.toBeNull();
  });
});

describe("AutoLockCountdown while hidden", () => {
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  afterEach(() => setHidden(false));

  it("reports the correct time on return rather than the value it held", () => {
    // Browsers throttle timers in hidden tabs hard, which is exactly the
    // left-open-options-page case. Interpolating from an absolute deadline
    // means the first frame back is right without asking the background.
    mountWith(10 * 60_000);
    expect(timer()?.textContent).toBe("10m");

    setHidden(true);
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    setHidden(false);

    expect(timer()?.textContent).toBe("5m");
  });

  it("runs no timer while hidden", () => {
    mountWith(10 * 60_000);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

describe("readCountdown", () => {
  it("scales the arc against the full window, not the time left", () => {
    const now = 1_000_000;
    const half = readCountdown(now + 5 * 60_000, now, 10 * 60_000);
    expect(half.fraction).toBeCloseTo(0.5);
  });

  it("clamps the arc to the window", () => {
    const now = 1_000_000;
    // A deadline further out than the window - the timeout was just raised.
    const over = readCountdown(now + 20 * 60_000, now, 10 * 60_000);
    expect(over.fraction).toBe(1);
  });

  it("treats a non-finite deadline as unavailable", () => {
    expect(readCountdown(Number.NaN, 0).state).toBe("unavailable");
    expect(readCountdown(undefined, 0).state).toBe("unavailable");
  });

  it("uses the singular for one unit", () => {
    const now = 1_000_000;
    expect(readCountdown(now + 1_000, now).label).toBe(
      "Vault locks in 1 second"
    );
    expect(readCountdown(now + 61_000, now).label).toBe(
      "Vault locks in 2 minutes"
    );
  });
});

describe("where the countdown is placed", () => {
  const REPO_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    ".."
  );
  const SRC_DIR = join(REPO_ROOT, "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  /** Files that render the countdown, excluding the component and its hook. */
  function placements(): string[] {
    return walk(SRC_DIR)
      .filter((file) => /<AutoLockCountdown\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file).split("\\").join("/"))
      .sort();
  }

  it("carries the countdown on exactly the three named surfaces", () => {
    expect(placements()).toEqual([
      "src/ui/components/layout/Header.tsx",
      "src/ui/features/settings/components/BasicSettings.tsx",
      "src/ui/features/settings/components/SecuritySettingsTab.tsx",
    ]);
  });

  it("puts no countdown on the approval window", () => {
    // The signing moment stays calm: a draining ring beside "Approve & sign"
    // is a clock on a decision that should not be hurried.
    for (const file of placements()) {
      expect(file).not.toContain("approval");
    }
    const approvalApp = readFileSync(
      join(SRC_DIR, "extension", "approval", "ApprovalApp.tsx"),
      "utf8"
    );
    expect(approvalApp).not.toContain("AutoLockCountdown");
    // And it does not reach one through the shared header either.
    expect(approvalApp).not.toContain("Header");
    expect(approvalApp).not.toContain("AppLayout");
  });
});

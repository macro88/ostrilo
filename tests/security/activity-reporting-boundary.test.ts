/**
 * What is allowed to postpone the auto-lock.
 *
 * `session-auto-lock` draws a line: deliberate user action records activity,
 * and background bookkeeping, broadcast handling, lock-state polling from a
 * locked UI, and countdown rendering do not. The line is easy to erase by
 * accident - a `reportActivity()` added inside the 5s poll, or a document-level
 * listener, would silently turn every open surface into a session that never
 * ends, and nothing else in the suite would notice.
 *
 * So the call sites are pinned here by name. Adding one is fine; it just has to
 * be a deliberate action, and adding it has to be deliberate too.
 *
 * There is now a second, narrower door. A signature produced without an
 * approval prompt postpones the lock too - but only behind a presence check,
 * because the page that asked for it is not evidence that anyone is there. The
 * background half of this file pins that gate: a `touchActivity()` call on the
 * signing path that is not wrapped in one is the unbounded-session hole, and
 * every behavioural test would still pass with it in place, because signing
 * WOULD postpone the lock - just always, rather than only when it should.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const CLIENT = join(SRC_DIR, "infrastructure", "messaging", "client.ts");

/**
 * The deliberate actions the spec names, and nothing else.
 *
 * `client.ts` is excluded: it defines the reporter rather than calling it.
 */
const ALLOWED_CALLERS: ReadonlySet<string> = new Set([
  "src/ui/state/KeyManagerContext.tsx", // unlock completion, key selection
  "src/ui/features/approval/components/ApprovalPrompt.tsx", // approval resolution
  "src/ui/hooks/useAppSettings.ts", // settings mutations
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files under `src/` that call the reporter, excluding its own definition. */
function callerFiles(): string[] {
  return walk(SRC_DIR)
    .filter((file) => file !== CLIENT)
    .filter((file) => /\breportActivity\s*\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(REPO_ROOT, file).split("\\").join("/"));
}

/** The body of the named function or arrow binding, by brace matching. */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `not found in source: ${declaration}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start + declaration.length - 1);
  expect(open).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after ${declaration}`);
}

describe("activity is reported only from deliberate action", () => {
  it("is called from no file outside the named set", () => {
    const unexpected = callerFiles().filter(
      (file) => !ALLOWED_CALLERS.has(file)
    );
    expect(
      unexpected,
      "a new caller of reportActivity(): confirm it is a deliberate user action, " +
        "not polling, a broadcast, or a countdown tick, then add it to ALLOWED_CALLERS"
    ).toEqual([]);
  });

  it("is still called from every site that is supposed to have one", () => {
    // Guards the opposite failure: the pin above passes vacuously if the
    // call sites are deleted, and the deadline would quietly stop sliding.
    expect(callerFiles().sort()).toEqual([...ALLOWED_CALLERS].sort());
  });

  it("is not reachable from the lock-state poll or the broadcast handler", () => {
    const source = readFileSync(
      join(SRC_DIR, "ui", "state", "lock-sync.ts"),
      "utf8"
    );
    expect(source, "the poll must not import the reporter at all").not.toMatch(
      /\breportActivity\b/
    );
    expect(bodyOf(source, "const sync = async ()")).not.toContain(
      "reportActivity"
    );
    expect(bodyOf(source, "const onMessage = (message: unknown)")).not.toContain(
      "reportActivity"
    );
  });

  it("reports on unlock only after the unlock has succeeded", () => {
    // The lock screen is the one surface a locked user can drive. A report
    // placed before the await would let a wrong password touch the deadline.
    const source = readFileSync(
      join(SRC_DIR, "ui", "state", "KeyManagerContext.tsx"),
      "utf8"
    );
    const body = bodyOf(source, "const unlock = useCallback(async (password: string)");
    const unlockCall = body.indexOf("await unlockVault(password)");
    const report = body.indexOf("reportActivity()");
    expect(unlockCall).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThan(unlockCall);
  });

  it("registers no document-level interaction listener to infer activity", () => {
    // The tempting version, and the wrong one: it cannot tell a deliberate
    // action from a scroll over a pinned sidepanel, and it fires on the lock
    // screen. See the design note in the change proposal.
    for (const file of walk(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      if (!/\breportActivity\b/.test(source)) continue;
      expect(
        /addEventListener\(\s*["'](pointerdown|mousedown|keydown|mousemove|scroll)["']/.test(
          source
        ),
        `${relative(REPO_ROOT, file)} infers activity from raw input events`
      ).toBe(false);
    }
  });

  it("throttles to one report per window", () => {
    const source = readFileSync(CLIENT, "utf8");
    expect(source).toContain("const ACTIVITY_THROTTLE_MS = 30_000;");
    const body = bodyOf(source, "export function reportActivity(): void");
    expect(body).toContain("ACTIVITY_THROTTLE_MS");
    expect(body).toContain("return");
  });
});

/**
 * Files that may call `touchActivity()` at all, and on what terms.
 *
 * `state-rpc.ts` serves the UI's `state.touch`, which is reached only by the
 * throttled reporter above - a deliberate action in a surface the user is
 * looking at. `nostr-rpc.ts` serves pages, so its call is admissible only
 * through the presence gate.
 */
const TOUCH_CALLERS: ReadonlyMap<string, "direct" | "presence-gated"> = new Map([
  ["src/infrastructure/messaging/handlers/state-rpc.ts", "direct"],
  ["src/infrastructure/messaging/handlers/nostr-rpc.ts", "presence-gated"],
]);

const VAULT_SERVICE = "src/application/services/key-vault.service.ts";

/**
 * Occurrences of a substring, ignoring whitespace entirely.
 *
 * Whitespace is stripped rather than collapsed: a formatter that wraps the
 * call across lines leaves a space before the closing paren, and a check that
 * merely collapses runs then fails on correct code - which is the worst
 * outcome for a guard, because the fix is to loosen the guard.
 */
function countIn(source: string, needle: string): number {
  const strip = (text: string) => text.replace(/\s+/g, "");
  return strip(source).split(strip(needle)).length - 1;
}

describe("a page-originated signature postpones the lock only through the gate", () => {
  function touchCallerFiles(): string[] {
    return walk(SRC_DIR)
      .filter((file) => relative(REPO_ROOT, file).split("\\").join("/") !== VAULT_SERVICE)
      .filter((file) => /\.touchActivity\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file).split("\\").join("/"))
      .sort();
  }

  it("is called from no file outside the named set", () => {
    const unexpected = touchCallerFiles().filter((f) => !TOUCH_CALLERS.has(f));
    expect(
      unexpected,
      "a new caller of touchActivity(): if it is reachable from a web page, it must " +
        "go through UserPresenceService.recordIfPresent, then be added to TOUCH_CALLERS"
    ).toEqual([]);
  });

  it("is still called from every site that is supposed to have one", () => {
    expect(touchCallerFiles()).toEqual([...TOUCH_CALLERS.keys()].sort());
  });

  it("wraps every signing-path call in the presence gate", () => {
    // The regression this exists for: drop the gate, keep the call, and the
    // vault is held open by any origin trusted enough to auto-sign. Every
    // behavioural test still passes, because signing still postpones the lock.
    for (const [file, terms] of TOUCH_CALLERS) {
      if (terms !== "presence-gated") continue;
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      const calls = countIn(source, ".touchActivity(");
      const gated = countIn(
        source,
        "recordIfPresent(() => context.vault.touchActivity())"
      );
      expect(
        gated,
        `${file}: every touchActivity() must sit inside recordIfPresent()`
      ).toBe(calls);
      expect(calls).toBeGreaterThan(0);
    }
  });

  it("consults presence rather than anything the request carries", () => {
    // Origin, kind, frequency and trust level are all under the control of the
    // thing the evidence is supposed to test, so none of them is admissible.
    const presence = readFileSync(
      join(SRC_DIR, "application", "services", "user-presence.service.ts"),
      "utf8"
    );
    expect(presence).toContain("queryIdle");
    for (const inadmissible of ["origin", "trustLevel", "kind"]) {
      expect(
        new RegExp(`\\b${inadmissible}\\b`).test(
          presence.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "")
        ),
        `presence must not read ${inadmissible} as evidence a user is present`
      ).toBe(false);
    }
  });

  it("treats a failed or non-active idle state as absence", () => {
    const presence = readFileSync(
      join(SRC_DIR, "application", "services", "user-presence.service.ts"),
      "utf8"
    );
    // Presence is the narrow case, absence the default: an equality test
    // against "active", never an inequality against "idle" that a third state
    // silently passes.
    expect(presence).toContain('=== "active"');
    expect(presence).not.toMatch(/!==\s*"idle"/);
    expect(presence).toContain("catch");
  });

  it("keeps the approval branch off the presence path", () => {
    // A user-resolved approval already records activity from the UI. A second,
    // presence-gated report there would make a click conditional on the OS
    // agreeing that the click happened.
    const source = readFileSync(
      join(SRC_DIR, "infrastructure", "messaging", "handlers", "nostr-rpc.ts"),
      "utf8"
    );
    const approvalBranch = source.slice(
      source.indexOf("if (requiresApproval)"),
      source.indexOf("const signResult")
    );
    expect(approvalBranch.length).toBeGreaterThan(200);
    expect(approvalBranch).not.toContain("recordIfPresent");
    expect(approvalBranch).not.toContain("touchActivity");
  });
});

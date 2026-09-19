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
      join(SRC_DIR, "ui", "state", "KeyManagerContext.tsx"),
      "utf8"
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

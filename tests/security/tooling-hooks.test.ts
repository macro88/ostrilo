/**
 * Tooling hooks run the pinned binary and nothing else.
 *
 * `openspec/specs/supply-chain-integrity` requires every hook this repository
 * runs automatically to invoke the locally installed, lockfile-pinned tool, to
 * fall back to no network fetch, and to say so when the tool is missing. These
 * hooks run on the machine that holds signing keys, on every commit and every
 * agent edit batch, so a fallback to `npx --yes react-doctor@latest` executes
 * whatever that tag points at on the day.
 *
 * The pre-commit hook is tracked in `.githooks/` so that this can be tested at
 * all. `react-doctor install` writes exactly that fallback into whichever
 * directory `core.hooksPath` names; in an untracked `.git/hooks/` the rewrite
 * left no trace.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRE_COMMIT = join(REPO_ROOT, ".githooks", "pre-commit");

const HOOKS = [
  { file: ".githooks/pre-commit", binary: "./node_modules/.bin/react-doctor" },
  { file: ".claude/hooks/react-doctor.sh", binary: "./node_modules/.bin/react-doctor" },
  { file: ".claude/hooks/aislop.sh", binary: "./node_modules/.bin/aislop" },
];

/** Package fetchers, and a PATH lookup that runs whichever version is installed globally. */
const UNPINNED = [
  /\bnpx\b/,
  /\b(?:pnpm|yarn)\s+dlx\b/,
  /\bbunx\b/,
  /@latest\b/,
  /command -v (?:react-doctor|aislop)\b/,
];

/**
 * The text of a shell script that can run something. Comments go, and so does
 * single-quoted text, which `sh` never expands or executes: a message telling
 * the reader not to use `npx` is not a call to it.
 */
function executableText(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/'[^']*'/g, "''"))
    .join("\n");
}

function unpinnedFetches(script: string): string[] {
  const text = executableText(script);
  return UNPINNED.filter((pattern) => pattern.test(text)).map(String);
}

describe("the unpinned-fetch check", () => {
  // Lines from the block react-doctor 0.9.14's installer writes.
  it.each([
    "    pnpm dlx react-doctor@latest --staged --blocking warning",
    "    npx --yes react-doctor@latest --staged --blocking warning",
    "  if command -v react-doctor >/dev/null 2>&1; then",
    "yarn dlx aislop scan",
    "bunx aislop scan",
  ])("catches %s", (line) => {
    expect(unpinnedFetches(line)).not.toEqual([]);
  });

  it("ignores comments and single-quoted messages", () => {
    const script = [
      "# No pnpm dlx / npx --yes fallback.",
      "printf '%s\\n' 'Do not substitute `npx aislop@latest`.' >&2",
    ].join("\n");

    expect(unpinnedFetches(script)).toEqual([]);
  });
});

describe.each(HOOKS)("$file", ({ file, binary }) => {
  const script = readFileSync(join(REPO_ROOT, file), "utf8");

  it("runs the pinned local binary", () => {
    expect(executableText(script)).toContain(binary);
  });

  it("fetches nothing from the network and looks nothing up on PATH", () => {
    expect(unpinnedFetches(script)).toEqual([]);
  });

  it("names the install command for a missing binary", () => {
    expect(script).toContain("Install it with:  pnpm install --frozen-lockfile");
  });
});

/** Runs the tracked hook in an empty project, optionally with a stub binary. */
function runPreCommit(stubBody?: string) {
  const project = mkdtempSync(join(tmpdir(), "ostrilo-pre-commit-"));
  try {
    if (stubBody !== undefined) {
      const bin = join(project, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "react-doctor"), `#!/bin/sh\n${stubBody}\n`);
      chmodSync(join(bin, "react-doctor"), 0o755);
    }
    return spawnSync("sh", [PRE_COMMIT], { cwd: project, encoding: "utf8" });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

describe("the pre-commit hook", () => {
  it("is executable, because git ignores a hook that is not", () => {
    expect(statSync(PRE_COMMIT).mode & 0o111).not.toBe(0);
  });

  it("says the scan did not run when the pinned binary is missing", () => {
    const { stderr } = runPreCommit();

    expect(stderr).toContain("React Doctor did not run:");
    expect(stderr).toContain("Install it with:  pnpm install --frozen-lockfile");
    expect(stderr).not.toContain("found staged regressions");
  });

  it("does not report a refusal to scan as a finding", () => {
    const { stderr } = runPreCommit(
      'echo "Cannot scan staged files: package.json has unstaged changes"; exit 1'
    );

    expect(stderr).toContain("React Doctor could not scan this commit. This is not a finding:");
    expect(stderr).toContain("package.json has unstaged changes");
    expect(stderr).not.toContain("found staged regressions");
  });

  it("shows the tool's own findings", () => {
    const { stderr } = runPreCommit('echo "src/App.tsx: no-danger"; exit 1');

    expect(stderr).toContain("React Doctor found staged regressions:");
    expect(stderr).toContain("src/App.tsx: no-danger");
  });

  it("is silent when the scan passes", () => {
    expect(runPreCommit("exit 0").stderr).toBe("");
  });
});

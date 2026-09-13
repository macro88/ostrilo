/**
 * Test-seam safety.
 *
 * Ostrilo has no weak-RNG seam in a production build today: `vitest.setup.ts`
 * assigns Node's WebCrypto only when the runtime has none, installs nothing
 * weaker, and nothing under `src/` imports anything from `tests/`. That is a
 * good property that no one is currently stopping someone from breaking for
 * convenience, so this file locks it down.
 *
 * Each test here is written to fail if the property is removed:
 *   - widen the setup guard so it overwrites an existing WebCrypto, and the
 *     guard tests go red;
 *   - swap in a seeded or Math.random-backed generator, and both the source
 *     scan and the runtime checks go red;
 *   - import a test helper from `src/`, and the import scan names the file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP_FILE = join(REPO_ROOT, "vitest.setup.ts");
const SRC_DIR = join(REPO_ROOT, "src");
const TESTS_DIR = join(REPO_ROOT, "tests");

function readSetupSource(): string {
  const source = readFileSync(SETUP_FILE, "utf8");
  // Guard against a vacuous pass if the file is ever moved or emptied.
  expect(source.length).toBeGreaterThan(200);
  return source;
}

/** Index just past the `{` that closes the block opened at `openBraceIndex`. */
function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced braces in vitest.setup.ts");
}

/** The `if (...)` guard that gates every write to `globalThis.crypto`. */
function locateCryptoGuard(source: string): {
  condition: string;
  blockStart: number;
  blockEnd: number;
} {
  const guard =
    /if\s*\(\s*!\s*globalThis\.crypto\s*\|\|\s*!\s*globalThis\.crypto\.subtle\s*\)\s*\{/.exec(
      source
    );
  if (!guard) {
    throw new Error(
      "vitest.setup.ts no longer guards its WebCrypto assignment with " +
        "`if (!globalThis.crypto || !globalThis.crypto.subtle)`. The harness " +
        "must never replace a WebCrypto implementation the runtime already has."
    );
  }
  const openBrace = guard.index + guard[0].length - 1;
  const conditionStart = source.indexOf("(", guard.index) + 1;
  const conditionEnd = source.lastIndexOf(")", openBrace);
  return {
    condition: source.slice(conditionStart, conditionEnd),
    blockStart: guard.index,
    blockEnd: findMatchingBrace(source, openBrace),
  };
}

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Every module specifier a file imports, however it is written. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import x from "y" / export * from "y"
    /\bimport\s*["']([^"']+)["']/g, // import "y"
    /\bimport\s*\(\s*["']([^"']+)["']/g, // await import("y")
    /\brequire\s*\(\s*["']([^"']+)["']/g, // require("y")
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

// ---------------------------------------------------------------------------
// 7.1 - the setup leaves an existing WebCrypto alone
// ---------------------------------------------------------------------------

describe("Test harness cannot weaken production crypto - setup guard", () => {
  it("guards every write to globalThis.crypto behind the missing-subtle check", () => {
    const source = readSetupSource();
    const guard = locateCryptoGuard(source);

    const writes = [
      ...source.matchAll(/globalThis\.crypto\s*=(?!=)/g),
      ...source.matchAll(
        /Object\.defineProperty\s*\(\s*globalThis\s*,\s*["']crypto["']/g
      ),
    ];

    // If there are no writes at all the guard proves nothing, so require them.
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      const index = write.index ?? -1;
      expect(
        index > guard.blockStart && index < guard.blockEnd,
        `vitest.setup.ts writes globalThis.crypto at offset ${index}, outside ` +
          `the \`if (!globalThis.crypto || !globalThis.crypto.subtle)\` block ` +
          `(${guard.blockStart}..${guard.blockEnd}). An unguarded write would ` +
          `let the harness replace a real WebCrypto implementation.`
      ).toBe(true);
    }
  });

  it("evaluates the real guard condition as false when subtle already exists", () => {
    // The condition is lifted verbatim out of vitest.setup.ts and evaluated
    // against sentinel globals, so this is the shipped guard being tested and
    // not a restatement of it.
    const { condition } = locateCryptoGuard(readSetupSource());
    const evaluate = new Function(
      "globalThis",
      `return Boolean(${condition});`
    ) as (sentinel: unknown) => boolean;

    // A runtime that already has full WebCrypto: leave it untouched.
    expect(evaluate({ crypto: { subtle: {}, getRandomValues() {} } })).toBe(
      false
    );
    // A runtime with no crypto, or crypto without subtle: fill it in.
    expect(evaluate({})).toBe(true);
    expect(evaluate({ crypto: {} })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7.2 - only Node's WebCrypto is installed
// ---------------------------------------------------------------------------

describe("Test harness cannot weaken production crypto - only Node WebCrypto", () => {
  it("imports nothing but node:crypto and node:util", () => {
    const specifiers = new Set(importSpecifiers(readSetupSource()));
    expect(specifiers.size).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        ["node:crypto", "node:util"].includes(specifier),
        `vitest.setup.ts imports "${specifier}". The harness may only pull ` +
          `Node's own WebCrypto and text encoders; any other module is a ` +
          `candidate crypto substitute.`
      ).toBe(true);
    }
    expect(readSetupSource()).toMatch(/\{\s*webcrypto\s*\}\s*=\s*require\(/);
  });

  it("contains no deterministic, seeded, or Math.random-backed generator", () => {
    const source = readSetupSource();
    const banned = [
      /Math\.random/,
      /seedrandom/i,
      /\bseed\b/i,
      /mulberry/i,
      /xorshift/i,
      /\bprng\b/i,
      /deterministic/i,
      /fakeCrypto|mockCrypto|cryptoMock|cryptoStub|cryptoShim/i,
      /vi\.(mock|stubGlobal|fn)\b/,
      /randomFillSync/,
    ];
    for (const pattern of banned) {
      expect(
        pattern.test(source),
        `vitest.setup.ts matches ${pattern}, which suggests a substituted or ` +
          `weakened random source.`
      ).toBe(false);
    }
  });

  it("leaves globalThis.crypto as Node's own WebCrypto at runtime", () => {
    // The setup has already run for this file. If it had installed a shim,
    // this identity check would fail.
    expect(globalThis.crypto).toBe(webcrypto);
    expect(globalThis.crypto.constructor.name).toBe("Crypto");
    expect(globalThis.crypto.subtle.constructor.name).toBe("SubtleCrypto");
    // No own-property override shadowing the prototype implementation.
    expect(
      Object.getOwnPropertyDescriptor(globalThis.crypto, "getRandomValues")
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle")
    ).toBeUndefined();
    expect(
      Function.prototype.toString.call(globalThis.crypto.getRandomValues)
    ).not.toMatch(/Math\.random|seed/i);
  });

  it("fills buffers in place with non-constant bytes", () => {
    const a = new Uint8Array(32);
    const returned = globalThis.crypto.getRandomValues(a);
    expect(returned).toBe(a);
    expect(a.some((byte) => byte !== 0)).toBe(true);

    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("computes the standard SHA-256 answer through crypto.subtle", async () => {
    // A substituted digest would almost certainly get this wrong.
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("abc")
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(hex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});

// ---------------------------------------------------------------------------
// 7.3 - production code cannot reach the harness
// ---------------------------------------------------------------------------

const TEST_ONLY_SPECIFIER =
  /(^|[/\\])tests?[/\\]|vitest\.setup|vitest\/config|(^|[/\\])(test|mock|fake|stub|shim)-crypto|crypto-(mock|shim|stub|fake)|(^|[/\\])__mocks__[/\\]/i;
const TEST_ONLY_PACKAGE =
  /^(vitest|@vitest\/.+|@playwright\/.+|playwright|jest|@jest\/.+|@testing-library\/.+)$/;

describe("Test harness is not reachable from production code", () => {
  it("no file under src/ imports the harness, anything under tests/, or a test-only crypto shim", () => {
    const files = walk(SRC_DIR, [".ts", ".tsx", ".js", ".jsx", ".mjs"]);
    // A broken walker must not produce a vacuous pass.
    expect(files.length).toBeGreaterThan(50);

    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const isBareTestPackage = TEST_ONLY_PACKAGE.test(specifier);
        const resolved = specifier.startsWith(".")
          ? relative(REPO_ROOT, resolve(dirname(file), specifier))
          : specifier;
        const looksTestOnly =
          TEST_ONLY_SPECIFIER.test(resolved) ||
          TEST_ONLY_SPECIFIER.test(specifier);
        if (isBareTestPackage || looksTestOnly) {
          violations.push(
            `${relative(REPO_ROOT, file)} imports "${specifier}"`
          );
        }
      }
    }

    expect(
      violations,
      "Production code must not be able to reach the test harness. A build " +
        "that can import a test-only crypto shim can ship one:\n" +
        violations.join("\n")
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7.4 - no uncollected script under tests/ presenting itself as coverage
// ---------------------------------------------------------------------------

describe("Stray test scripts are not presented as coverage", () => {
  it("has no uncollected script at the top level of tests/", () => {
    // Scoped to the top level of tests/ deliberately: that is where
    // tests/test-crypto.ts sat, and subdirectories legitimately hold support
    // modules (fixtures, vector loaders) that the suites next to them import.
    const topLevel = readdirSync(TESTS_DIR).filter(
      (entry) =>
        statSync(join(TESTS_DIR, entry)).isFile() &&
        /\.(ts|tsx|js|mjs)$/.test(entry)
    );
    const uncollected = topLevel.filter(
      (entry) => !/\.(test|spec)\./.test(entry)
    );
    expect(
      uncollected,
      "Vitest only collects files with a .test./.spec. infix. Anything else " +
        "at the top level of tests/ never runs, yet counts towards the " +
        "apparent size of the suite:\n" +
        uncollected.join("\n")
    ).toEqual([]);
  });

  it("no longer contains the tests/test-crypto.ts development script", () => {
    expect(existsSync(join(TESTS_DIR, "test-crypto.ts"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { KEY_HANDLING_DOCUMENTS } from "@/infrastructure/messaging/key-handling-documents";
import { buildOutputPresent } from "./build-output";

/**
 * The build-output half of the realm guarantee.
 *
 * `tests/security/key-material-realm-isolation.test.tsx` asserts the source
 * rules. This file asserts what was actually emitted, because the defect class
 * here is precisely the gap between the two: a small-looking `Logo.tsx` once
 * dragged an 892,763-byte three.js chunk into every one of `popup.html`,
 * `sidepanel.html`, `options.html` and `approval.html`, visible only in
 * `.output/`. three.js has since been removed; this file keeps it from
 * returning.
 *
 * WHAT IT WALKS. For each key-handling document: the entry module named by
 * `<script type="module" src>`, every `<link rel="modulepreload">` hint, and
 * then the transitive closure of STATIC imports from those chunks. Dynamic
 * `import()` is deliberately NOT followed: a dynamic import is the lazy
 * boundary, and following it would make the boundary invisible to the guard
 * that exists to check it.
 *
 * RUNNING IT. It needs real build output. `pnpm run test:build-output` builds
 * both targets and then runs this file, which is what the `Extension builds`
 * job does. Run bare, with nothing built, it skips and names the command - and
 * a skip is not a pass, which is why the build-output entry condition lives in
 * `./build-output.ts`: with `OSTRILO_REQUIRE_BUILD_OUTPUT=1` set, as the build
 * job sets it, a missing target fails instead of skipping.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const TARGETS = [
  { name: "chrome-mv3", command: "pnpm run build" },
  { name: "firefox-mv3", command: "pnpm run build:firefox" },
];

/**
 * Markers that mean a 3D engine is in the chunk.
 *
 * `WebGLRenderer` and `GLTFLoader` are class names three.js emits verbatim even
 * after minification, because they are used in its own error strings.
 */
const FORBIDDEN_MARKERS = [
  "WebGLRenderer",
  "GLTFLoader",
  "THREE.WebGLRenderer",
];

/**
 * Transitive byte ceiling for one key-handling document.
 *
 * The marker list is a denylist and therefore catches three.js and not the next
 * heavy dependency somebody adds. The ceiling is the backstop: an unnamed
 * heavy addition fails too. A three.js chunk alone is about 600 KB, so this
 * number leaves working headroom for the app and cannot be satisfied with a 3D
 * engine in the graph.
 *
 * Raising it is a decision, not a formality: say in the commit message which
 * dependency justified it.
 */
const DOCUMENT_BYTE_CEILING = 800_000;

/** `<script type="module" src>` and `<link rel="modulepreload" href>`. */
function documentEntryChunks(html: string): string[] {
  const refs = new Set<string>();
  for (const match of html.matchAll(
    /<script[^>]+type="module"[^>]+src="([^"]+)"/g
  )) {
    refs.add(match[1]);
  }
  for (const match of html.matchAll(
    /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g
  )) {
    refs.add(match[1]);
  }
  return [...refs];
}

/**
 * Relative `.js` specifiers this chunk imports statically.
 *
 * Everything quoted that looks like a relative module path, minus the ones that
 * appear as the argument to `import(`.
 */
function staticImports(code: string): string[] {
  const dynamic = new Set(
    [...code.matchAll(/\bimport\(\s*["']([^"']+\.js)["']\s*\)/g)].map(
      (m) => m[1]
    )
  );
  const all = new Set(
    [...code.matchAll(/["'](\.{1,2}\/[^"']*\.js)["']/g)].map((m) => m[1])
  );
  return [...all].filter((specifier) => !dynamic.has(specifier));
}

/** Resolves a chunk reference, absolute (`/chunks/x.js`) or relative. */
function resolveChunk(
  outputDir: string,
  fromFile: string,
  specifier: string
): string {
  return specifier.startsWith("/")
    ? path.join(outputDir, specifier.slice(1))
    : path.resolve(path.dirname(fromFile), specifier);
}

/** The transitive static chunk set reachable from one document. */
function reachableChunks(outputDir: string, documentName: string): string[] {
  const html = readFileSync(path.join(outputDir, documentName), "utf8");
  const queue = documentEntryChunks(html).map((ref) =>
    resolveChunk(outputDir, path.join(outputDir, documentName), ref)
  );
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const specifier of staticImports(code)) {
      queue.push(resolveChunk(outputDir, file, specifier));
    }
  }

  return [...seen];
}

for (const target of TARGETS) {
  const outputDir = path.join(REPO_ROOT, ".output", target.name);
  const built = existsSync(outputDir);

  describe(`${target.name}: key-handling documents exclude 3D libraries`, () => {
    if (!buildOutputPresent(built, target.command)) return;

    it.each(KEY_HANDLING_DOCUMENTS)(
      "%s reaches no chunk containing a 3D engine",
      (documentName) => {
        const chunks = reachableChunks(outputDir, documentName);
        expect(chunks.length).toBeGreaterThan(0);

        const offenders: string[] = [];
        for (const chunk of chunks) {
          const code = readFileSync(chunk, "utf8");
          for (const marker of FORBIDDEN_MARKERS) {
            if (code.includes(marker)) {
              offenders.push(
                `${documentName} -> ${path.relative(outputDir, chunk)} contains ${marker}`
              );
            }
          }
        }

        expect(offenders).toEqual([]);
      }
    );

    it.each(KEY_HANDLING_DOCUMENTS)(
      "%s stays under the transitive byte ceiling",
      (documentName) => {
        const bytes = reachableChunks(outputDir, documentName).reduce(
          (total, chunk) => total + statSync(chunk).size,
          0
        );

        expect(
          bytes,
          `${documentName} loads ${bytes} bytes of JavaScript before anything is lazy`
        ).toBeLessThanOrEqual(DOCUMENT_BYTE_CEILING);
      }
    );
  });
}

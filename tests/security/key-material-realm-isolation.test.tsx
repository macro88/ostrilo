/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Logo } from "@/ui/components/logo/Logo";
import { KEY_HANDLING_DOCUMENTS } from "@/infrastructure/messaging/key-handling-documents";

/**
 * No document that can hold a private key or a master password may also load a
 * 3D engine.
 *
 * A three.js chunk of 892,763 bytes was once referenced by `popup.html`,
 * `sidepanel.html`, `options.html` AND `approval.html` - the realm in which
 * `revealKey()` returns an nsec into a ref, the master password sits in reducer
 * state, and the approval screen claims to show truthfully what is about to be
 * signed. One compromised release anywhere in the `three` dependency tree reads
 * all of it off the heap: a bad npm publish, not a browser exploit.
 *
 * The 3D mascot has since been removed. These source and runtime assertions keep
 * it from coming back; the build-output half is
 * `tests/security/key-handling-bundle.test.ts`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 3D and WebGL packages that must not become dependencies again. */
const FORBIDDEN_PACKAGES = ["three", "@react-three/fiber", "@react-three/drei", "babylonjs", "@babylonjs/core"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

function render(ui: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("no 3D engine is reachable from source", () => {
  it("package.json depends on no 3D or WebGL library", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(declared.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
  });

  it("no file under src/ imports a 3D library or loads a WebGL context", () => {
    const offenders = sourceFiles(path.join(REPO_ROOT, "src")).filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /from\s+["'](three|@react-three\/|babylonjs|@babylonjs\/)/.test(source) ||
        /getContext\(\s*["']webgl2?["']/.test(source)
      );
    });

    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });
});

describe("key-handling surfaces render a static mark", () => {
  it("Logo renders an <img> and never a canvas", () => {
    const container = render(<Logo size="max" />);

    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("lists every shipped document as key-handling", () => {
    const shipped = readdirSync(path.join(REPO_ROOT, "src/extension"))
      .filter((entry) => statSync(path.join(REPO_ROOT, "src/extension", entry)).isDirectory())
      .map((entry) => `${entry}.html`)
      .sort();

    expect([...KEY_HANDLING_DOCUMENTS].sort()).toEqual(shipped);
  });
});

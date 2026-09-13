/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Logo } from "@/ui/components/logo/Logo";
import {
  KEY_HANDLING_DOCUMENTS,
  MODEL_CAPABLE_DOCUMENTS,
  isModelCapableDocument,
} from "@/ui/components/logo/key-handling-documents";

/**
 * No document that can hold a private key or a master password may also load a
 * 3D engine.
 *
 * The built chunk `chunks/useTheme-*.js` was 892,763 bytes, contained
 * `WebGLRenderer`, and was referenced by `popup.html`, `sidepanel.html`,
 * `options.html` AND `approval.html`. That is the realm in which `revealKey()`
 * returns an nsec into a ref, the master password sits in reducer state, and
 * the approval screen claims to show truthfully what is about to be signed. One
 * compromised release anywhere in the `three` dependency tree reads all of it
 * off the heap - a bad npm publish, not a browser exploit.
 *
 * These are source and runtime assertions. The build-output half lives in
 * `tests/security/key-handling-bundle.test.ts`.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOGO_SOURCE = readFileSync(
  path.join(REPO_ROOT, "src/ui/components/logo/Logo.tsx"),
  "utf8"
);

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

function setDocument(name: string) {
  // jsdom's location is not writable; the helper reads `location.pathname` by
  // default and accepts an explicit value, which is what the component uses.
  vi.spyOn(globalThis, "location", "get").mockReturnValue({
    pathname: `/${name}`,
  } as Location);
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.restoreAllMocks();
});

describe("the 3D model is not in any document's synchronous graph", () => {
  it("Logo does not statically import ModelViewer", () => {
    // A static `import SceneSetup from "./ModelViewer"` puts three.js and
    // GLTFLoader into the importing document's initial chunk graph. This is the
    // single line whose reversion re-creates the original defect.
    expect(LOGO_SOURCE).not.toMatch(
      /^\s*import\s+\w+\s+from\s+["']\.\/ModelViewer["']/m
    );
    expect(LOGO_SOURCE).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(/);
  });

  it("keeps a same-size static poster as the Suspense fallback", () => {
    expect(LOGO_SOURCE).toContain("Suspense");
    expect(LOGO_SOURCE).toContain("ostriloPoster");
  });

  it("falls back to the poster rather than surfacing an error", () => {
    expect(LOGO_SOURCE).toContain("getDerivedStateFromError");
  });
});

describe("key-handling documents render a static mascot", () => {
  it.each(KEY_HANDLING_DOCUMENTS)(
    "%s renders an <img>, never a WebGL canvas",
    (document_) => {
      setDocument(document_);
      const container = render(<Logo size="max" mode="model" />);

      expect(container.querySelector("img")).not.toBeNull();
      expect(container.querySelector("canvas")).toBeNull();
    }
  );

  it("refuses the model in a document it does not recognise", () => {
    setDocument("some-new-surface.html");
    expect(isModelCapableDocument()).toBe(false);

    const container = render(<Logo size="max" mode="model" />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("refuses the model when there is no document at all", () => {
    // Workers, server rendering, test harnesses. Fails closed.
    expect(isModelCapableDocument(undefined)).toBe(false);
  });

  it("lists every shipped document as key-handling", () => {
    expect([...KEY_HANDLING_DOCUMENTS].sort()).toEqual([
      "approval.html",
      "options.html",
      "popup.html",
      "sidepanel.html",
    ]);
  });

  it("allows the model only where the declaration says so", () => {
    for (const document_ of MODEL_CAPABLE_DOCUMENTS) {
      expect(KEY_HANDLING_DOCUMENTS).not.toContain(document_);
    }
  });
});

describe("no key surface asks for the model", () => {
  const surfaces = [
    "src/ui/features/onboarding/components/OnboardingWelcome.tsx",
    "src/ui/features/onboarding/components/OnboardingCreateKey.tsx",
    "src/ui/features/onboarding/components/OnboardingCreateKeyBackupStep.tsx",
  ];

  it.each(surfaces)("%s does not pass mode=\"model\"", (relative) => {
    // Comments in these files name the removed attribute on purpose; only what
    // the bundler sees counts.
    const source = readFileSync(path.join(REPO_ROOT, relative), "utf8")
      .replace(/\{?\s*\/\*[\s\S]*?\*\/\s*\}?/g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(source).not.toMatch(/mode=["']model["']/);
  });
});

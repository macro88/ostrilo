/**
 * The options header and the Advanced tab each hardcoded "1.0.0" while the
 * extension shipped 0.0.1. A signer that misreports its own version is a real
 * problem: the version is what a user checks to confirm they are running a
 * build that carries a security fix.
 *
 * The fix reads it from the manifest, which WXT generates from package.json at
 * build time and which therefore cannot drift.
 */
import { describe, expect, it, afterEach } from "vitest";
import { extensionVersion } from "@/ui/lib/extension-version";

type Globals = { browser?: unknown; chrome?: unknown };

function setRuntime(getManifest: (() => { version?: string }) | undefined) {
  (globalThis as Globals).chrome = { runtime: { getManifest } };
}

afterEach(() => {
  delete (globalThis as Globals).chrome;
  delete (globalThis as Globals).browser;
});

describe("extensionVersion", () => {
  it("reports the version the manifest declares", () => {
    setRuntime(() => ({ version: "0.0.1" }));
    expect(extensionVersion()).toBe("0.0.1");
  });

  it("tracks the manifest rather than a baked-in constant", () => {
    setRuntime(() => ({ version: "2.4.7" }));
    expect(extensionVersion()).toBe("2.4.7");
  });

  it("prefers the browser namespace when both are present", () => {
    (globalThis as Globals).browser = {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
    };
    setRuntime(() => ({ version: "0.0.1" }));
    expect(extensionVersion()).toBe("9.9.9");
  });

  // Showing nothing is honest. Showing a plausible-looking number that is not
  // the running build is the bug this file exists to prevent.
  it("claims no version when there is no runtime at all", () => {
    expect(extensionVersion()).toBe("");
  });

  it("claims no version when the manifest read throws", () => {
    setRuntime(() => {
      throw new Error("no runtime");
    });
    expect(extensionVersion()).toBe("");
  });

  it("claims no version when the manifest omits it", () => {
    setRuntime(() => ({}));
    expect(extensionVersion()).toBe("");
  });
});

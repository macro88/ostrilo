import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildOutputPresent } from "./build-output";

/**
 * WebAuthn is reachable from one module, and never from the background.
 *
 * A ceremony needs a visible document, and its output opens the vault. Keeping
 * `navigator.credentials` in a single adapter means there is one place to read
 * to know what is asked of an authenticator, and the background worker - which
 * holds the keys - never has the API in its bundle at all.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO_ROOT, "src");
const ADAPTER = "src/infrastructure/webauthn/webauthn-ceremony.adapter.ts";
const ADAPTER_IMPORT = "@/infrastructure/webauthn/webauthn-ceremony.adapter";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(REPO_ROOT, file);

describe("WebAuthn boundary", () => {
  const files = sourceFiles(SRC).map((file) => ({
    file: relative(file),
    code: readFileSync(file, "utf8"),
  }));

  it("touches navigator.credentials in exactly one module", () => {
    const users = files
      .filter(({ code }) => /navigator\s*\.\s*credentials/.test(code))
      .map(({ file }) => file);
    expect(users).toEqual([ADAPTER]);
  });

  it("is imported only by the unlock window and the options page's settings", () => {
    const importers = files
      .filter(({ code }) => code.includes(ADAPTER_IMPORT))
      .map(({ file }) => file)
      .sort();

    for (const importer of importers) {
      expect(
        importer.startsWith("src/extension/unlock/") ||
          importer.startsWith("src/ui/features/settings/"),
        `${importer} imports the ceremony adapter`
      ).toBe(true);
    }
    expect(importers).toContain("src/extension/unlock/UnlockCeremonyApp.tsx");
  });

  const firefox = path.join(REPO_ROOT, ".output", "firefox-mv3");

  describe("the Firefox build", () => {
    if (!buildOutputPresent(existsSync(firefox), "pnpm run build:firefox")) return;

    const builtFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) return builtFiles(full);
        return /\.(js|html)$/.test(entry) ? [full] : [];
      });

    it("carries no credentials API, no wrapping and no unlock document", () => {
      const offenders = builtFiles(firefox).filter((file) =>
        /navigator\.credentials|PublicKeyCredential|vaultBiometric/.test(
          readFileSync(file, "utf8")
        )
      );
      expect(offenders.map(relative)).toEqual([]);
      expect(existsSync(path.join(firefox, "unlock.html"))).toBe(false);
    });
  });

  const background = path.join(REPO_ROOT, ".output", "chrome-mv3", "background.js");

  describe("the built background worker", () => {
    if (!buildOutputPresent(existsSync(background), "pnpm run build")) return;

    it("contains no reference to the credentials API", () => {
      const code = readFileSync(background, "utf8");
      expect(code).not.toMatch(/navigator\.credentials|credentials\.(create|get)\(/);
      expect(code).not.toContain("PublicKeyCredential");
    });
  });
});

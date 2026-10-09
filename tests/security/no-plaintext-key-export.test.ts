import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  createKeyBackup,
  openKeyBackup,
  serializeKeyBackup,
} from "@/ui/features/backup/key-backup-envelope";

/**
 * The plaintext key download is gone and must stay gone.
 *
 * `OnboardingCreateKey.handleDownloadKey` built
 * `{ name, privateKey: nsec, privateKeyHex, createdAt }`, wrapped it in a
 * `Blob`, and saved it through a synthetic anchor click under a filename that
 * carried the key's name. The file landed in Downloads - routinely synced to
 * iCloud, OneDrive or Dropbox, captured by Time Machine, indexed by Spotlight,
 * and the first directory commodity infostealer malware reads. A Nostr identity
 * cannot be rotated, so the exposure is permanent.
 *
 * Two assertions, because either alone is weak. The source scan catches a new
 * plaintext writer being added anywhere in `src/`. The behavioural test catches
 * the export itself quietly ceasing to encrypt.
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments describe the removed defect by name; only code counts. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = sourceFiles(SRC_ROOT).map((file) => ({
  file: path.relative(SRC_ROOT, file),
  code: stripComments(readFileSync(file, "utf8")),
}));

/** Files allowed to hand the browser a file at all. */
const DOWNLOAD_ALLOWLIST = new Set([
  // Writes the encrypted envelope, and nothing else.
  "ui/features/backup/components/BackupEncryptedExport.tsx",
  // Activity log export. Carries no key material.
  "ui/features/settings/components/ActivityLogTab.tsx",
]);

describe("no source path writes a private key to disk in the clear", () => {
  it("has no `privateKeyHex` field anywhere in code", () => {
    const offenders = FILES.filter(({ code }) =>
      code.includes("privateKeyHex")
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("keeps file downloads to an explicit allowlist", () => {
    const downloaders = FILES.filter(
      ({ code }) =>
        code.includes("URL.createObjectURL") || /\.download\s*=/.test(code)
    ).map(({ file }) => file);

    for (const file of downloaders) {
      expect(
        DOWNLOAD_ALLOWLIST.has(file),
        `${file} writes a file to disk and is not on the reviewed allowlist`
      ).toBe(true);
    }
  });

  it("never puts an nsec or a raw key into a Blob", () => {
    const offenders = FILES.filter(({ code }) => {
      if (!code.includes("new Blob")) return false;
      // The only Blob in a key surface must be the serialized envelope.
      return /new Blob\([^)]*\bnsec\b/i.test(code);
    }).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("puts no key name in an exported filename", () => {
    const offenders = FILES.filter(({ code }) =>
      /\.download\s*=[^;]*keyName/.test(code)
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("the only export path produces ciphertext", () => {
  const payload = {
    nsec: "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
    hex: "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa",
    name: "Everyday identity",
  };

  it("writes a file containing no readable key material", async () => {
    const contents = serializeKeyBackup(
      await createKeyBackup(payload, "correct-horse-battery-staple-42")
    );

    expect(contents).not.toContain(payload.nsec);
    expect(contents).not.toContain(payload.hex);
    expect(contents).not.toContain(payload.name);
    expect(contents).not.toMatch(/nsec1/);
    // Also not in any case-folded or whitespace-stripped form.
    expect(contents.toLowerCase().replace(/\s+/g, "")).not.toContain(
      payload.hex.toLowerCase()
    );
  });

  it("still restores the exact key it sealed", async () => {
    const envelope = await createKeyBackup(payload, "correct-horse-battery-42");
    const recovered = await openKeyBackup(envelope, "correct-horse-battery-42");

    expect(recovered.nsec).toBe(payload.nsec);
    expect(recovered.hex).toBe(payload.hex);
  });
});

describe("key material does not leave the realm by any other route", () => {
  const ONBOARDING = FILES.filter(({ file }) =>
    file.startsWith("ui/features/onboarding/")
  );

  it("has onboarding files to inspect", () => {
    // Guards against a rename silently emptying every assertion below.
    expect(ONBOARDING.length).toBeGreaterThan(5);
  });

  it("writes nothing to localStorage or sessionStorage", () => {
    const offenders = ONBOARDING.filter(({ code }) =>
      /\b(localStorage|sessionStorage)\b/.test(code)
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("stages nothing in extension storage for a handoff", () => {
    const offenders = ONBOARDING.filter(({ code }) =>
      /\b(chrome|browser)\.storage\b/.test(code)
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("puts nothing in a URL, query string, or hash fragment", () => {
    const offenders = ONBOARDING.filter(({ code }) =>
      /(location\.(href|hash|search)\s*=|history\.(push|replace)State|new URLSearchParams)/.test(
        code
      )
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("broadcasts nothing", () => {
    const offenders = ONBOARDING.filter(({ code }) =>
      /\b(BroadcastChannel|postMessage)\b/.test(code)
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("logs nothing from the create-key or import flows", () => {
    // Production builds drop `console`, so a log here is a development-time
    // leak into the devtools of anyone who opens them - including on a shared
    // screen. The old copy-failure path did exactly this.
    const offenders = ONBOARDING.filter(({ code }) =>
      /\bconsole\.\w+\(/.test(code)
    ).map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildOutputPresent } from "./build-output";

/**
 * Build-output assertions for the generated extension manifests.
 *
 * Why this suite exists, specifically. Every security property this project
 * declares about its manifest - the content security policy, the permission
 * set, the injection surface, the absence of a persistent background context -
 * is a property of a file that WXT *generates*. Nothing read that file. That is
 * how `sidebar_action` shipped for months carrying WXT's scaffold placeholders
 * (`"browser_style": "true|false"`, a JavaScript object literal serialised as
 * the `default_icon` string, and `"default_title": "Default Side Panel Title"`).
 *
 * So these assertions deliberately read `.output/<target>/manifest.json` rather
 * than `wxt.config.ts`. Asserting on the config would be cheaper and wrong: the
 * defect class here is precisely the gap between what the config says and what
 * the build tool emits. `sidePanel` is in the Chrome manifest and *not* in the
 * config, because WXT adds it for MV3 sidepanel entrypoints. The placeholder
 * `sidebar_action` was in the manifest and not in the config, because WXT reads
 * `manifest.*` meta tags out of the entrypoint HTML. Only the generated file is
 * the truth.
 *
 * Established by the OpenSpec change `harden-manifest-and-build`.
 *
 * Running it. The suite needs real build output. Use
 * `pnpm run test:manifest`, which builds both targets and then runs this file,
 * or `pnpm run test:build-output` for this file and the key-handling bundle
 * guard together. Run bare, with nothing built, it skips and names the command.
 * That skip is not a pass: the entry condition lives in `./build-output.ts`,
 * and with `OSTRILO_REQUIRE_BUILD_OUTPUT=1` set - as both of those scripts and
 * the `Extension builds` job set it - a missing target fails instead.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * The content security policy declared in `wxt.config.ts`, directive by
 * directive, asserted against what WXT actually emitted.
 */
const REQUIRED_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "object-src": ["'self'"],
  // 'unsafe-inline' is REQUIRED here, not tolerated. react-style-singleton -
  // reached through react-remove-scroll and therefore through every Radix
  // dialog - injects a <style> element at runtime. Removing this source breaks
  // dialog scroll-lock styling with no error of any kind.
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "https:"],
  // No 'self': nothing in an extension page fetches a bundled file, so the
  // extension origin is not a network destination. Relays need wss:, and
  // profile image upload needs the one declared host.
  "connect-src": ["wss:", "https://nostr.build"],
  "font-src": ["'self'"],
  "frame-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};

/** Source expressions that must not appear anywhere in the policy. */
const FORBIDDEN_CSP_SOURCES = ["'unsafe-eval'", "wasm-unsafe-eval"];

/**
 * Permissions the extension is reviewed to request.
 *
 * `alarms` is listed but not required: `implement-session-auto-lock` adds it
 * for the idle timer. Listing it here means that change does not have to edit
 * this assertion to land, while an unreviewed permission still fails.
 *
 * `idle` is called, and here is the recorded decision. `gate-autosign-activity-on-idle`
 * uses `browser.idle.queryState` at exactly one call site
 * (`background.ts`, wired into `UserPresenceService`) to decide whether a
 * signature produced without an approval prompt may postpone the auto-lock
 * deadline. It is the only evidence of user presence a requesting page cannot
 * fabricate. It returns one of three words about input recency - `active`,
 * `idle`, `locked` - and discloses nothing about what was typed, which window
 * had focus, or what is on screen.
 */
const REVIEWED_PERMISSIONS = new Set([
  "storage",
  "windows",
  "sidePanel",
  "alarms",
  "idle",
]);

/** Permissions that must be present on every target. */
const REQUIRED_PERMISSIONS = ["storage", "windows"];

/**
 * Host match patterns for the NIP-07 provider injection surface.
 *
 * Kept identical to `PROVIDER_MATCHES` in `wxt.config.ts` and to `matches` in
 * `src/extension/content.ts`. `harden-provider-trust-boundary` owns whether
 * plaintext `http://` origins keep the provider; narrowing the surface means a
 * deliberate edit to this literal, which is the point.
 *
 * Narrowed to `https:` only: a plaintext page is one an on-path attacker can
 * rewrite, so the provider is not offered there at all.
 */
const PROVIDER_MATCHES = ["https://*/*"];

/**
 * Scaffold and template strings that must never reach a generated manifest.
 * Each entry is a real defect that shipped, or the same class of defect in a
 * key nobody has thought of yet.
 */
const PLACEHOLDER_PATTERNS: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: "WXT boolean placeholder `true|false`", test: (v) => v.includes("true|false") },
  {
    label: "WXT scaffold title `Default Side Panel Title`",
    test: (v) => v.includes("Default Side Panel Title"),
  },
  {
    label: "WXT scaffold icon path `/icon-16.png`",
    test: (v) => v.includes("/icon-16.png"),
  },
  { label: "ellipsis placeholder", test: (v) => v.includes("...") || v.includes("…") },
  { label: "unsubstituted template `{{...}}`", test: (v) => /\{\{.*\}\}/.test(v) },
];

/**
 * Manifest keys whose specification defines a boolean. A string here is the
 * signature of a scaffold placeholder that got copied through verbatim.
 */
const BOOLEAN_MANIFEST_KEYS = new Set([
  "browser_style",
  "chrome_style",
  "open_at_install",
  "open_in_tab",
  "persistent",
  "use_dynamic_url",
  "all_frames",
  "match_about_blank",
]);

interface Target {
  label: string;
  outDir: string;
  buildCommand: string;
  manifestVersion: number;
  /** Chrome-only manifest keys. */
  expectsSidePanelPermission: boolean;
  expectsDynamicUrl: boolean;
}

const TARGETS: Target[] = [
  {
    label: "chrome",
    outDir: ".output/chrome-mv3",
    buildCommand: "pnpm run build",
    manifestVersion: 3,
    expectsSidePanelPermission: true,
    expectsDynamicUrl: true,
  },
  {
    label: "firefox",
    outDir: ".output/firefox-mv3",
    buildCommand: "pnpm run build:firefox",
    manifestVersion: 3,
    // WXT's Firefox branch emits `sidebar_action` rather than `side_panel`, and
    // `sidePanel` is not a valid Firefox permission name.
    expectsSidePanelPermission: false,
    // `use_dynamic_url` is Chrome-only; Firefox randomises the moz-extension://
    // origin per install, so the resource URL is not stable there regardless.
    expectsDynamicUrl: false,
  },
];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const raw of policy.split(";")) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    directives.set(parts[0], parts.slice(1));
  }
  return directives;
}

/** Every string leaf in the manifest, with the dotted key path that reached it. */
function collectStrings(value: Json, keyPath: string, into: Array<[string, string]>): void {
  if (typeof value === "string") {
    into.push([keyPath, value]);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${keyPath}[${index}]`, into));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStrings(entry, keyPath ? `${keyPath}.${key}` : key, into);
    }
  }
}

/** Every key/value pair in the manifest, with the dotted key path. */
function collectEntries(
  value: Json,
  keyPath: string,
  into: Array<[string, string, Json]>
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectEntries(entry, `${keyPath}[${index}]`, into));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      into.push([nextPath, key, entry]);
      collectEntries(entry, nextPath, into);
    }
  }
}

function walkFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, into);
    else into.push(full);
  }
  return into;
}

/**
 * A `console` CALL, not a `console` reference.
 *
 * esbuild's `drop: ["console"]` removes call expressions. It does not remove a
 * reference such as `logger.debug = (...a) => print(console.debug, ...a)`,
 * which WXT's own internal logger emits and whose `print` is compiled to an
 * empty function in production. Those references never write to the console, so
 * matching on the bare word `console` would fail the build for nothing.
 */
const CONSOLE_CALL = /console\s*\.\s*[A-Za-z_$][\w$]*\s*\(|console\s*\[/;

for (const target of TARGETS) {
  const outDir = path.join(REPO_ROOT, target.outDir);
  const manifestPath = path.join(outDir, "manifest.json");

  describe(`generated manifest: ${target.label}`, () => {
    if (!buildOutputPresent(existsSync(manifestPath), target.buildCommand)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, Json>;

    describe("content security policy", () => {
      it("declares extension_pages", () => {
        expect(
          manifest.content_security_policy,
          "SECURITY REGRESSION: no content_security_policy in the generated manifest. The signer must declare its own policy, not inherit a browser default."
        ).toBeDefined();
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        expect(typeof policy).toBe("string");
        expect(policy.length).toBeGreaterThan(0);
      });

      it.each(Object.entries(REQUIRED_CSP_DIRECTIVES))(
        "declares %s with the reviewed sources",
        (directive, sources) => {
          const csp = manifest.content_security_policy as Record<string, string> | string;
          const policy = typeof csp === "string" ? csp : csp.extension_pages;
          const parsed = parseCsp(policy);
          expect(
            parsed.has(directive),
            `SECURITY REGRESSION: CSP directive \`${directive}\` was removed from the ${target.label} manifest.`
          ).toBe(true);
          for (const source of sources) {
            expect(
              parsed.get(directive),
              `SECURITY REGRESSION: \`${source}\` was removed from \`${directive}\` in the ${target.label} manifest. See wxt.config.ts for why each source is load-bearing.`
            ).toContain(source);
          }
        }
      );

      it("allows connect-src exactly the reviewed destinations, and no more", () => {
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        expect(
          [...(parseCsp(policy).get("connect-src") ?? [])].sort(),
          `SECURITY REGRESSION: \`connect-src\` in the ${target.label} manifest was widened. Every network destination is reviewed in wxt.config.ts.`
        ).toEqual([...REQUIRED_CSP_DIRECTIVES["connect-src"]].sort());
      });

      it("never carries a dev-server source into a shipped policy", () => {
        // The dev CSP is deliberately wider: `wxt dev` serves modules, styles,
        // images and its HMR socket from http://localhost:3000, and the strict
        // policy blocks all four. That relaxation is gated on `command ===
        // "serve"` in wxt.config.ts, and this asserts the gate holds — a
        // production build that trusted a plaintext localhost origin would let
        // any process on the machine serve code to the signer.
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        for (const forbidden of ["localhost", "http://", "ws://"]) {
          expect(
            policy,
            `SECURITY REGRESSION: \`${forbidden}\` appeared in the ${target.label} CSP. The dev-server relaxation must never reach a build.`
          ).not.toContain(forbidden);
        }
      });

      it("never allows eval or WebAssembly compilation", () => {
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        for (const forbidden of FORBIDDEN_CSP_SOURCES) {
          expect(
            policy,
            `SECURITY REGRESSION: \`${forbidden}\` appeared in the ${target.label} CSP.`
          ).not.toContain(forbidden);
        }
      });

      it("restricts script execution to bundled code", () => {
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        const scriptSrc = parseCsp(policy).get("script-src") ?? [];
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("*");
        for (const source of scriptSrc) {
          expect(
            source.startsWith("http://") || source.startsWith("https://"),
            `SECURITY REGRESSION: remote script origin \`${source}\` appeared in script-src.`
          ).toBe(false);
        }
      });

      it("forbids every plaintext transport", () => {
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        const parsed = parseCsp(policy);
        const connectSrc = parsed.get("connect-src") ?? [];
        const imgSrc = parsed.get("img-src") ?? [];
        expect(
          connectSrc,
          "SECURITY REGRESSION: plaintext `ws:` allowed. A relay entry could be downgraded to an unencrypted socket."
        ).not.toContain("ws:");
        expect(connectSrc).not.toContain("http:");
        expect(
          imgSrc,
          "SECURITY REGRESSION: plaintext `http:` allowed for images. A relay-supplied avatar URL could reveal to a network observer which npub is being viewed."
        ).not.toContain("http:");
      });

      it("declares a closed default-src", () => {
        const csp = manifest.content_security_policy as Record<string, string> | string;
        const policy = typeof csp === "string" ? csp : csp.extension_pages;
        expect(parseCsp(policy).get("default-src")).not.toContain("*");
      });
    });

    describe("permissions", () => {
      it("requests only reviewed permissions", () => {
        const permissions = (manifest.permissions ?? []) as string[];
        for (const permission of permissions) {
          expect(
            REVIEWED_PERMISSIONS.has(permission),
            `Unreviewed permission \`${permission}\` in the ${target.label} manifest. Add it to REVIEWED_PERMISSIONS here only alongside a recorded decision that the extension calls the API.`
          ).toBe(true);
        }
      });

      it.each(REQUIRED_PERMISSIONS)("requests %s", (permission) => {
        expect(manifest.permissions as string[]).toContain(permission);
      });

      it(
        target.expectsSidePanelPermission
          ? "requests sidePanel, which WXT adds for the MV3 sidepanel entrypoint"
          : "does not request sidePanel, which is not a valid Firefox permission",
        () => {
          const permissions = (manifest.permissions ?? []) as string[];
          if (target.expectsSidePanelPermission) {
            expect(permissions).toContain("sidePanel");
            expect(manifest.side_panel).toBeDefined();
          } else {
            expect(permissions).not.toContain("sidePanel");
          }
        }
      );

      it("declares no host permissions", () => {
        expect(
          manifest.host_permissions,
          "SECURITY REGRESSION: host_permissions appeared. The content script's own matches grant what the extension needs."
        ).toBeUndefined();
      });
    });

    describe("injection surface", () => {
      it("exposes injected.js only to the content script's own origins", () => {
        const resources = manifest.web_accessible_resources as Array<{
          resources: string[];
          matches?: string[];
          use_dynamic_url?: boolean;
        }>;
        const entry = resources.find((item) => item.resources?.includes("injected.js"));
        expect(entry, "no web_accessible_resources entry lists injected.js").toBeDefined();
        expect(entry!.matches).toEqual(PROVIDER_MATCHES);
        expect(entry!.matches).not.toContain("<all_urls>");
        for (const pattern of entry!.matches ?? []) {
          expect(
            pattern.includes("://"),
            `web-accessible resource match \`${pattern}\` is not scheme-qualified.`
          ).toBe(true);
        }
      });

      it(
        target.expectsDynamicUrl
          ? "serves injected.js under a per-session dynamic URL"
          : "omits the Chrome-only use_dynamic_url key",
        () => {
          const resources = manifest.web_accessible_resources as Array<{
            resources: string[];
            use_dynamic_url?: boolean;
          }>;
          const entry = resources.find((item) => item.resources?.includes("injected.js"))!;
          if (target.expectsDynamicUrl) {
            expect(
              entry.use_dynamic_url,
              "SECURITY REGRESSION: injected.js is served from a stable chrome-extension:// URL again. Any page can probe it to learn the user runs a Nostr signer."
            ).toBe(true);
          } else {
            expect(entry.use_dynamic_url).toBeUndefined();
          }
        }
      );

      it("declares the provider content script with the asserted matches", () => {
        const scripts = manifest.content_scripts as Array<{
          matches: string[];
          run_at?: string;
          js?: string[];
        }>;
        const provider = scripts.find((script) =>
          script.js?.some((file) => file.includes("content"))
        );
        expect(provider, "no provider content script in the manifest").toBeDefined();
        expect(
          provider!.matches,
          "The provider injection surface changed. That is `harden-provider-trust-boundary`'s decision to make - update PROVIDER_MATCHES here and in wxt.config.ts deliberately."
        ).toEqual(PROVIDER_MATCHES);
        expect(provider!.run_at).toBe("document_start");
      });
    });

    describe("background context", () => {
      it("declares the manifest version the build configuration pins", () => {
        expect(manifest.manifest_version).toBe(target.manifestVersion);
      });

      it("is not a persistent background page", () => {
        const background = manifest.background as {
          service_worker?: string;
          scripts?: string[];
          persistent?: boolean;
        };
        expect(background).toBeDefined();
        expect(
          background.persistent,
          "SECURITY REGRESSION: a persistent background context holds decrypted key material for the whole browser session."
        ).not.toBe(true);
        if (manifest.manifest_version === 2) {
          expect(background.persistent).toBe(false);
        } else {
          expect(
            typeof background.service_worker === "string" || Array.isArray(background.scripts)
          ).toBe(true);
        }
      });
    });

    describe("no scaffold values survive", () => {
      it("contains no placeholder string in any key", () => {
        const strings: Array<[string, string]> = [];
        collectStrings(manifest as Json, "", strings);
        const offenders: string[] = [];
        for (const [keyPath, value] of strings) {
          for (const pattern of PLACEHOLDER_PATTERNS) {
            if (pattern.test(value)) {
              offenders.push(`${keyPath}: ${pattern.label} -> ${JSON.stringify(value)}`);
            }
          }
        }
        expect(offenders, `placeholder values in ${target.outDir}/manifest.json`).toEqual([]);
      });

      it("gives every boolean manifest field a JSON boolean", () => {
        const entries: Array<[string, string, Json]> = [];
        collectEntries(manifest as Json, "", entries);
        const offenders = entries
          .filter(([, key, value]) => BOOLEAN_MANIFEST_KEYS.has(key) && typeof value !== "boolean")
          .map(([keyPath, , value]) => `${keyPath} = ${JSON.stringify(value)}`);
        expect(offenders, "boolean manifest fields holding a non-boolean").toEqual([]);
      });

      it("names Ostrilo wherever a user-visible title is declared", () => {
        const sidebar = manifest.sidebar_action as { default_title?: string } | undefined;
        if (sidebar) expect(sidebar.default_title).toContain("Ostrilo");
        const action = (manifest.action ?? manifest.browser_action) as
          | { default_title?: string }
          | undefined;
        if (action?.default_title) expect(action.default_title).toContain("Ostrilo");
      });
    });

    describe("build output hygiene", () => {
      const files = walkFiles(outDir);
      const scripts = files.filter((file) => file.endsWith(".js"));

      it("emits no source map files", () => {
        const maps = files.filter((file) => file.endsWith(".map")).map((f) => path.relative(outDir, f));
        expect(maps, `source maps in ${target.outDir}`).toEqual([]);
      });

      it("emits no inline source map comments", () => {
        const offenders = scripts
          .filter((file) => readFileSync(file, "utf-8").includes("sourceMappingURL"))
          .map((f) => path.relative(outDir, f));
        expect(offenders, `sourceMappingURL comments in ${target.outDir}`).toEqual([]);
      });

      it("contains no console call in any production bundle", () => {
        const offenders = scripts
          .filter((file) => CONSOLE_CALL.test(readFileSync(file, "utf-8")))
          .map((f) => path.relative(outDir, f));
        expect(
          offenders,
          `console calls survived the production build in ${target.outDir}. The esbuild \`drop\` setting in wxt.config.ts should have removed them.`
        ).toEqual([]);
      });

      it("ships no unreferenced root icon", () => {
        // These are copied from public/ and referenced by no manifest key - the
        // `icons` block points at the sized files auto-icons generates. They are
        // excluded from the published archive by `zip.exclude` in wxt.config.ts;
        // this asserts the manifest still does not reference them, so the
        // exclusion cannot break anything.
        const strings: Array<[string, string]> = [];
        collectStrings(manifest as Json, "", strings);
        const referenced = strings.map(([, value]) => value);
        expect(referenced).not.toContain("icon.png");
        expect(referenced).not.toContain("icon.svg");
      });
    });
  });
}

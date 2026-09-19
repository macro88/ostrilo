import { defineConfig } from "wxt";
import "@wxt-dev/module-react";
import "@wxt-dev/auto-icons";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Content Security Policy for every extension page, and — on MV3 — for the
 * background context as well.
 *
 * Rationale for each directive lives in
 * `openspec/changes/harden-manifest-and-build/design.md` (Decision 1). The two
 * that look looser than they should be are deliberate and their failure modes
 * are silent, so do not tighten them without re-running the manual smoke:
 *
 * - `connect-src 'self'` — GLTFLoader fetches the bundled `.glb` over XHR.
 *   Remove `'self'` and the 3D logo silently fails to render.
 * - `style-src 'unsafe-inline'` — `react-style-singleton`, reached through
 *   every Radix dialog, injects a `<style>` element at runtime. Remove it and
 *   dialogs silently lose their scroll-lock styling.
 *
 * `wss:` is a scheme wildcard because relay hosts are user data and cannot be
 * enumerated in a static manifest. It still forbids plaintext `ws:`.
 */
const EXTENSION_PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' wss: https://nostr.build",
  "font-src 'self'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * The dev server's origin, added to the policy only while `wxt dev` is running.
 *
 * WXT relaxes `script-src` for serve mode itself, and stops there. Everything
 * else Vite serves over the same origin stays blocked, which broke `pnpm dev`
 * in four ways that never named their cause:
 *
 * - `img-src` — asset imports resolve to `http://localhost:3000/...`, so the
 *   mascot rendered as a broken-image icon on every surface.
 * - `style-src` — the Tailwind stylesheet is served as a `<link>`, so pages
 *   rendered with only the inline styles Radix injects at runtime.
 * - `connect-src` — Vite's HMR websocket never connected, so neither hot
 *   reload nor extension auto-reload worked.
 * - `connect-src`, again and worst — on MV3 serve builds WXT emits no
 *   `content_scripts` key and registers the script at runtime *over that same
 *   websocket*. With the socket blocked the provider was never registered, so
 *   `window.nostr` did not exist under `pnpm dev` at all.
 *
 * This is a real widening, and it is why it is gated on the command rather than
 * on a mode name or an env var. A serve build already runs with broader
 * privilege than a shipped one, is gitignored, and `wxt zip` only ever builds
 * production. `tests/security/manifest-assertions.test.ts` asserts that no
 * built manifest carries a localhost, `http:` or `ws:` source.
 */
const DEV_SERVER_CSP_SOURCES: Record<string, string> = {
  // Asset imports and the Tailwind <link> are fetched over http.
  "img-src": "http://localhost:*",
  "style-src": "http://localhost:*",
  // Vite's client fetches over http; its HMR channel and WXT's reload channel
  // are websockets. Plaintext `ws:` is acceptable here and nowhere else: the
  // peer is a dev server on the loopback interface.
  "connect-src": "http://localhost:* ws://localhost:*",
};

function extensionPagesCsp(command: "serve" | "build"): string {
  if (command !== "serve") return EXTENSION_PAGES_CSP;

  return EXTENSION_PAGES_CSP.split("; ")
    .map((directive) => {
      const name = directive.slice(0, directive.indexOf(" "));
      const extra = DEV_SERVER_CSP_SOURCES[name];
      return extra ? `${directive} ${extra}` : directive;
    })
    .join("; ");
}

/**
 * Host match patterns for the NIP-07 provider injection surface.
 *
 * This list MUST stay identical to `matches` in `src/extension/content.ts`:
 * a web-accessible resource that is reachable from an origin the content
 * script does not run on is exposed for nothing. `harden-provider-trust-boundary`
 * owns whether plaintext `http://` origins keep the provider; this change only
 * keeps the two lists — and `tests/security/manifest-assertions.test.ts` —
 * in agreement.
 *
 * Narrowed to `https:` only by `harden-provider-trust-boundary`: on a
 * plaintext page an on-path attacker controls the document and can drive
 * `window.nostr` as the origin the user trusts, which no approval dialog can
 * detect. See `docs/local-https-development.md`.
 */
const PROVIDER_MATCHES = ["https://*/*"];

/**
 * Files a Mozilla reviewer needs in order to reproduce the submitted build.
 *
 * WXT's source-archive filter is `include-match OR NOT exclude-match`
 * (`node_modules/wxt/dist/core/zip.mjs`), so pairing this allowlist with an
 * `excludeSources` entry of `**\/*` makes the archive fail closed: a new
 * top-level directory is excluded by default rather than shipped by default.
 */
const SOURCES_ALLOWLIST = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "wxt.config.ts",
  "tsconfig.json",
  "components.json",
  "LICENSE",
  "README.md",
  "src/**",
  "public/**",
];

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
  srcDir: "src",
  entrypointsDir: "extension",
  // Firefox would default to MV2, which means a persistent background page
  // holding decrypted key material for the whole browser session. MV3 makes
  // background suspension a platform guarantee on both targets.
  manifestVersion: 3,
  manifest: (env) => ({
    // Reviewed permission set. `storage` holds the encrypted vault, `windows`
    // drives the approval window. `sidePanel` is deliberately absent: WXT adds
    // it automatically for MV3 sidepanel entrypoints on Chromium, and it is
    // not a valid Firefox permission name.
    // `alarms` backs the auto-lock deadline. A setTimeout cannot do this job:
    // an MV3 service worker is evicted after ~30s idle and the timer dies with
    // it, so a timer-only auto-lock silently never fires.
    // `idle` reports whether the machine has had operating-system input
    // recently - `active`, `idle`, or `locked`, and nothing else. It is what
    // separates "a person is here" from "a page is doing things" when a
    // silently-signed request asks to postpone the auto-lock deadline. A page
    // cannot observe or forge it, which is the whole reason it is the evidence.
    permissions: ["storage", "windows", "alarms", "idle"],
    content_security_policy: {
      extension_pages: extensionPagesCsp(env.command),
    },
    // Make injected script accessible to the pages the content script runs on,
    // for the NIP-07 provider.
    web_accessible_resources: [
      {
        resources: ["injected.js"],
        matches: PROVIDER_MATCHES,
        // Chrome-only. Serves the resource under a per-session GUID so a page
        // cannot probe a fixed chrome-extension:// URL to fingerprint the user
        // as a Nostr signer. WXT's `injectScript` resolves through
        // `runtime.getURL`, which is dynamic-URL aware. Firefox already
        // randomises the moz-extension:// origin per install and treats the
        // key as unknown, so it is omitted there.
        ...(env.browser === "firefox" ? {} : { use_dynamic_url: true }),
      },
    ],
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  }),
  zip: {
    // Belt and braces: production builds emit no source maps today (WXT only
    // sets `build.sourcemap` in serve mode), so this stops a future local
    // debugging flag from shipping one. The two root icons are copied from
    // `public/` and referenced by no manifest key — the `icons` block points at
    // the sized files `@wxt-dev/auto-icons` generates from `src/assets/icon.png`.
    exclude: ["**/*.map", "icon.png", "icon.svg"],
    includeSources: SOURCES_ALLOWLIST,
    // `**/*` is the fail-closed base; the named entries below it document the
    // offenders that made this necessary. WXT's built-in exclusions never read
    // `.gitignore`, so `test-results/` (278 MB of Playwright output, including
    // Chromium profile directories holding the extension's own vault storage
    // from E2E runs) was being uploaded to Mozilla.
    excludeSources: [
      "**/*",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
      "docs/**",
      "openspec/**",
      "stats.html",
      "stats-*.json",
      "**/*.bak",
      "logs/**",
      "**/*.log",
    ],
  },
  vite: (env) => ({
    // Cast because wxt bundles its own vite types; tailwindcss() returns Plugin[] from root Vite
    plugins: tailwindcss() as unknown as any[],
    // Strip debug logging from production output. Declared once here rather
    // than guarded at 110 call sites in `src/`, and it also covers dependencies
    // that log. Development builds keep console output.
    // `remove-key-exfiltration-surface` owns deleting the individual log
    // statements whose *content* is the problem; this setting is the build-level
    // backstop and is owned solely by this change.
    esbuild:
      env.mode === "production" ? { drop: ["console", "debugger"] } : {},
    css: {
      // Tailwind Vite plugin currently expects PostCSS pipeline; LightningCSS lacks createIdResolver
      transformer: "postcss",
    },
    assetsInclude: ["**/*.glb", "**/*.gltf"],
    resolve: {
      alias: {
        "@/components": path.resolve(__dirname, "./src/ui/components"),
        "@/hooks": path.resolve(__dirname, "./src/ui/hooks"),
        "@/lib": path.resolve(__dirname, "./src/ui/lib"),
        "@/assets": path.resolve(__dirname, "./src/assets"),
        "@/infrastructure": path.resolve(__dirname, "./src/infrastructure"),
        "@/application": path.resolve(__dirname, "./src/application"),
        "@/domain": path.resolve(__dirname, "./src/domain"),
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      /**
       * Never inline a font as a `data:` URI.
       *
       * Vite inlines any asset under ~4KB, which caught four JetBrains Mono
       * subsets. `font-src 'self'` then blocked every one of them at runtime:
       * the CSP has no `data:` source, and adding one to admit our own bundled
       * fonts would also admit an attacker-supplied face. Emitting them as
       * files keeps the directive as strict as it is and makes the bundled
       * fonts actually load, which DESIGN_RULES §4 requires.
       */
      assetsInlineLimit: (filePath: string) =>
        /\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined,
      rollupOptions: {
        external: [],
        output: {
          globals: {},
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
    },
    optimizeDeps: {
      include: ["@noble/curves", "@noble/hashes", "@scure/base", "three"],
    },
  }),
});

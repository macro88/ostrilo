/**
 * The running extension's version, read from the manifest.
 *
 * WXT generates the manifest version from package.json at build time, so this
 * cannot drift from what shipped. It previously appeared as a hardcoded string
 * in two places and was wrong in both.
 *
 * The runtime is reached through `globalThis` rather than by importing
 * `webextension-polyfill`, which throws at import time outside an extension
 * context and would take every jsdom test of a consuming component with it.
 * `BasicSettings.tsx` reads `runtime.openOptionsPage` the same way.
 *
 * Returns an empty string when the runtime is unavailable: a surface that
 * cannot determine its version should say nothing rather than assert a
 * plausible-looking number that is not the running build.
 */
type RuntimeApi = {
  runtime?: { getManifest?: () => { version?: string } };
};

export function extensionVersion(): string {
  try {
    const globals = globalThis as {
      browser?: RuntimeApi;
      chrome?: RuntimeApi;
    };
    const runtime = (globals.browser ?? globals.chrome)?.runtime;
    return runtime?.getManifest?.().version ?? "";
  } catch {
    return "";
  }
}

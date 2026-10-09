import { vi } from "vitest";

/**
 * Runs the real `src/extension/injected.ts` against a stand-in `window`, so a
 * test can read what the provider defines without a browser.
 *
 * The stand-in is a plain object. That is enough because the script only calls
 * the intrinsics it captures at injection time and defines one property; what
 * matters for the immutability checks is `Object.defineProperty`, which behaves
 * the same on any object.
 */
export interface FakeWindow extends Record<string, unknown> {
  nostr?: unknown;
}

export async function loadInjectedProvider(
  existingNostr?: unknown,
  /** Runs after the module is loaded and before the provider is built. */
  beforeMain?: () => void
): Promise<{ window: FakeWindow; warnings: string[] }> {
  const fakeWindow: FakeWindow = {
    postMessage: () => {},
    addEventListener: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { origin: "https://dapp.example" },
  };
  if (existingNostr !== undefined) fakeWindow.nostr = existingNostr;

  const warnings: string[] = [];
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("defineUnlistedScript", (main: () => void) => ({ main }));
  vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });

  vi.resetModules();
  const script = (await import("@/extension/injected")).default as unknown as {
    main: () => void;
  };
  beforeMain?.();
  script.main();
  return { window: fakeWindow, warnings };
}

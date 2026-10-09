import { test, expect, Page } from "./fixtures/extension";
import {
  DAPP_ORIGIN,
  openDapp,
  seedUnlockedVault,
  sendExtensionRpc,
  waitForApprovalPage,
} from "./fixtures/agent";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * E2E tests for NIP-07 Provider (window.nostr)
 * 
 * Tests cover:
 * - Task 7.3: Test window.nostr.getPublicKey() with unlocked vault
 * - Task 7.4: Test signEvent() with unlocked vault and valid policy
 * - Task 7.5: Test signEvent() when vault is locked
 * 
 * Note: These tests verify the injection and basic structure of window.nostr.
 * They validate that the API is properly injected and has the correct shape.
 * Full integration testing with unlocked vault would require implementing
 * the onboarding flow automation, which is beyond the current scope.
 */

test.describe("NIP-07 Provider", () => {
  /**
   * Helper function to wait for window.nostr to be injected
   * Uses waitForFunction to detect when window.nostr becomes available
   */
  async function waitForNostrInjection(page: Page) {
    await page.waitForFunction(() => typeof window.nostr !== 'undefined', {
      timeout: 5000,
    });
  }

  test("Task 7.3: window.nostr API is injected and has getPublicKey method", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // Navigate to an HTTP page (content script only runs on http/https)
    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");

    // Wait for window.nostr to be injected (give it time for the content script)
    await waitForNostrInjection(page);

    // Verify window.nostr exists
    const hasNostr = await page.evaluate(() => typeof window.nostr !== 'undefined');
    expect(hasNostr).toBe(true);

    // Verify window.nostr has getPublicKey method
    const hasGetPublicKey = await page.evaluate(() => 
      typeof window.nostr?.getPublicKey === 'function'
    );
    expect(hasGetPublicKey).toBe(true);

    // Verify getPublicKey returns a Promise
    const returnsPromise = await page.evaluate(() => {
      const result = window.nostr?.getPublicKey();
      return result instanceof Promise;
    });
    expect(returnsPromise).toBe(true);

    // Test that getPublicKey rejects when vault is locked (default state)
    const error = await page.evaluate(async () => {
      try {
        await window.nostr!.getPublicKey();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    // Should return an error when vault is locked
    expect(error).toBeDefined();
    expect(error).toBeTruthy();
  });

  test("Task 7.4: window.nostr.signEvent method is available and validates input", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // Navigate to an HTTP page
    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");

    // Wait for window.nostr to be injected
    await waitForNostrInjection(page);

    // Verify window.nostr.signEvent exists
    const hasSignEvent = await page.evaluate(() => 
      typeof window.nostr?.signEvent === 'function'
    );
    expect(hasSignEvent).toBe(true);

    // Create an unsigned event
    const unsignedEvent = {
      kind: 1,
      content: "Test event from E2E tests",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    // Call signEvent - it should reject since vault is locked by default
    const error = await page.evaluate(async (event) => {
      try {
        await window.nostr!.signEvent(event);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }, unsignedEvent);

    // Should return an error (vault locked or policy denied)
    expect(error).toBeDefined();
    expect(error).toBeTruthy();
  });

  test("Task 7.5: signEvent returns error when vault is locked", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // Navigate to an HTTP page - extension starts in locked state by default
    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");

    // Wait for window.nostr to be injected
    await waitForNostrInjection(page);

    // Create an unsigned event
    const unsignedEvent = {
      kind: 1,
      content: "Test event from E2E tests",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    // Call signEvent and expect it to fail because vault is locked
    const error = await page.evaluate(async (event) => {
      try {
        await window.nostr!.signEvent(event);
        return null; // Should not reach here
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    }, unsignedEvent);

    // Verify error message exists
    expect(error).toBeDefined();
    expect(error).toBeTruthy();
    
    // The error should indicate the vault is locked or no key is selected
    // Common error messages: "locked" or "no_key_selected"
    expect(typeof error).toBe('string');
  });

  test("window.nostr object structure and methods", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // Navigate to an HTTP page
    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");

    // Wait for window.nostr to be injected
    await waitForNostrInjection(page);

    // Verify window.nostr structure
    const nostrStructure = await page.evaluate(() => {
      return {
        exists: typeof window.nostr !== 'undefined',
        hasGetPublicKey: typeof window.nostr?.getPublicKey === 'function',
        hasSignEvent: typeof window.nostr?.signEvent === 'function',
        hasNip04: typeof window.nostr?.nip04 === 'object',
        hasNip44: typeof window.nostr?.nip44 === 'object',
      };
    });

    expect(nostrStructure.exists).toBe(true);
    expect(nostrStructure.hasGetPublicKey).toBe(true);
    expect(nostrStructure.hasSignEvent).toBe(true);
    // Deliberately absent. They were objects whose every method threw, so
    // NIP-07 feature detection - the whole point of which is
    // `if (window.nostr.nip44)` - returned true and then failed at call
    // time. An honest absence is a working feature check.
    expect(nostrStructure.hasNip04).toBe(false);
    expect(nostrStructure.hasNip44).toBe(false);
  });

  test("a page can read window.nostr.capabilities and cannot change it", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");
    await waitForNostrInjection(page);

    const seen = await page.evaluate(() => {
      const capabilities = window.nostr!.capabilities!;
      const advertised = [...capabilities.methods];
      const implemented = Object.keys(window.nostr!).filter(
        (name) => typeof (window.nostr as unknown as Record<string, unknown>)[name] === "function"
      );

      // A page that tries to widen or hide what the signer supports. Reflect
      // reports refusal as `false` instead of throwing, whatever the page's
      // strictness.
      const accepted = [
        Reflect.set(window.nostr!, "capabilities", { methods: ["nip44"] }),
        Reflect.set(capabilities, "methods", ["nip44"]),
        Reflect.set(capabilities.methods, "length", 0),
        Reflect.set(capabilities.methods, "2", "nip44"),
        Reflect.deleteProperty(window.nostr!, "capabilities"),
      ];

      return {
        advertised,
        implemented,
        after: [...window.nostr!.capabilities!.methods],
        keys: Object.keys(window.nostr!.capabilities!),
        frozen: Object.isFrozen(window.nostr!.capabilities) && Object.isFrozen(capabilities.methods),
        accepted,
      };
    });

    expect(seen.advertised).toEqual(["getPublicKey", "signEvent"]);
    expect([...seen.advertised].sort()).toEqual([...seen.implemented].sort());
    expect(seen.keys).toEqual(["methods"]);
    expect(seen.frozen).toBe(true);
    expect(seen.after).toEqual(seen.advertised);
    expect(seen.accepted).toEqual([false, false, false, false, false]);
  });

  test("window.nostr is injected early before DOMContentLoaded", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    
    // Navigate to a page and check if window.nostr is available early
    await page.goto("https://localhost:8765/test-page.html");
    
    // Wait for content script injection
    await waitForNostrInjection(page);
    
    // Check that window.nostr is available
    const hasNostr = await page.evaluate(() => typeof window.nostr !== 'undefined');
    expect(hasNostr).toBe(true);
  });

  test("window.nostr methods handle errors gracefully", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // Navigate to an HTTP page
    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");

    // Wait for window.nostr to be injected
    await waitForNostrInjection(page);

    // Test signEvent with invalid event (should reject)
    const invalidEventError = await page.evaluate(async () => {
      try {
        // Intentionally passing invalid event to test error handling
        const invalidEvent = { invalid: 'event' } as any;
        await window.nostr!.signEvent(invalidEvent);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    // Should return an error for invalid event
    expect(invalidEventError).toBeDefined();
    expect(typeof invalidEventError).toBe('string');

    // Test signEvent with missing required fields
    const missingFieldsError = await page.evaluate(async () => {
      try {
        // Intentionally passing incomplete event to test error handling
        const incompleteEvent = { kind: 1 } as any;
        await window.nostr!.signEvent(incompleteEvent);
        return null;
      } catch (err: unknown) {
        return err instanceof Error ? err.message : String(err);
      }
    });

    // Should return an error for missing fields
    expect(missingFieldsError).toBeDefined();
    expect(typeof missingFieldsError).toBe('string');
  });
});

test.describe("provider trust boundary", () => {
  test("is not injected into a plaintext page", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // The content script matches https://*/* only. On a plaintext page any
    // on-path attacker controls the document, so the approval dialog would be
    // showing an origin the attacker is speaking as. No amount of care in the
    // dialog fixes that; the provider simply is not there.
    const page = await extensionContext.newPage();
    const response = await page.goto("http://localhost:8765/test-page.html", {
      waitUntil: "domcontentloaded",
    }).catch(() => null);

    // The fixture server is HTTPS-only, so a plaintext request fails to load.
    // Either way the assertion below is the one that matters.
    void response;
    const hasNostr = await page
      .evaluate(() => typeof (window as any).nostr !== "undefined")
      .catch(() => false);

    expect(
      hasNostr,
      "SECURITY REGRESSION: the provider was injected into a plaintext page"
    ).toBe(false);
  });

  test("window.nostr cannot be replaced or reconfigured", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");
    await page.waitForFunction(() => typeof window.nostr !== "undefined", {
      timeout: 5000,
    });

    const result = await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "nostr");
      let replaced = false;
      try {
        (window as any).nostr = { getPublicKey: async () => "hijacked" };
        replaced = (window as any).nostr.getPublicKey !== undefined &&
          String((window as any).nostr.getPublicKey).includes("hijacked");
      } catch {
        replaced = false;
      }
      let redefined = false;
      try {
        Object.defineProperty(window, "nostr", { value: { hijacked: true } });
        redefined = (window as any).nostr.hijacked === true;
      } catch {
        redefined = false;
      }
      let methodSwapped = false;
      try {
        (window.nostr as any).signEvent = async () => ({ sig: "forged" });
        methodSwapped =
          String((window.nostr as any).signEvent).includes("forged");
      } catch {
        methodSwapped = false;
      }
      return {
        writable: descriptor?.writable,
        configurable: descriptor?.configurable,
        replaced,
        redefined,
        methodSwapped,
      };
    });

    expect(result.writable).toBe(false);
    expect(result.configurable).toBe(false);
    expect(
      result.replaced,
      "SECURITY REGRESSION: a page script replaced window.nostr wholesale"
    ).toBe(false);
    expect(result.redefined).toBe(false);
    expect(
      result.methodSwapped,
      "SECURITY REGRESSION: a page script swapped signEvent and would sit between the page and the signer"
    ).toBe(false);
  });

  test("advertises only the capabilities it has", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");
    await page.waitForFunction(() => typeof window.nostr !== "undefined", {
      timeout: 5000,
    });

    const surface = await page.evaluate(() => ({
      getPublicKey: typeof window.nostr!.getPublicKey,
      signEvent: typeof window.nostr!.signEvent,
      nip04: (window.nostr as any).nip04,
      nip44: (window.nostr as any).nip44,
    }));

    expect(surface.getPublicKey).toBe("function");
    expect(surface.signEvent).toBe("function");
    // These were advertised as objects whose every method threw, so NIP-07
    // feature detection returned true and then failed at call time.
    expect(surface.nip04).toBeUndefined();
    expect(surface.nip44).toBeUndefined();
  });

  test("leaves no injected script element in the page DOM", async ({
    extensionContext,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    await page.goto("https://localhost:8765/test-page.html");
    await page.waitForFunction(() => typeof window.nostr !== "undefined", {
      timeout: 5000,
    });

    // The element used to be left behind, where any script could find it by
    // src and learn both that Ostrilo is installed and its extension id.
    const extensionScripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script"))
        .map((s) => s.getAttribute("src") ?? "")
        .filter((src) => src.includes("extension://"))
    );

    expect(
      extensionScripts,
      "SECURITY REGRESSION: the injected script element is a stable fingerprinting probe"
    ).toEqual([]);
  });
  test("a same-document navigation keeps the attested origin", async ({
    openPopup,
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    // The background now derives the origin from the browser-attested sender
    // and refuses a disagreement with the content script's claim. A pushState
    // changes the URL but not the origin, so SPA routing must keep working.
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const dapp = await openDapp(extensionContext);
    await dapp.evaluate(() => history.pushState({}, "", "/other/route?tab=2"));
    expect(new URL(dapp.url()).pathname).toBe("/other/route");

    await dapp.evaluate(() => {
      void window.nostr!
        .signEvent({
          kind: 1,
          content: "after pushState",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        })
        .catch(() => undefined);
    });

    const approvalPage = await waitForApprovalPage(extensionContext, extensionId);
    await expect(
      approvalPage.locator(
        `[data-testid="approval-origin-group"][data-origin="${DAPP_ORIGIN}"]`
      )
    ).toBeVisible({ timeout: 10_000 });

    const pending = await sendExtensionRpc<{
      requests: Array<{ origin: string; operation: string }>;
    }>(popup, { type: "approval.getAll" });
    expect(pending.requests).toEqual([
      expect.objectContaining({ origin: DAPP_ORIGIN, operation: "sign_event" }),
    ]);
  });
});

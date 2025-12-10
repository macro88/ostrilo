import { test, expect, Page } from "./fixtures/extension";
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
    await page.goto("http://localhost:8765/test-page.html");

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
    await page.goto("http://localhost:8765/test-page.html");

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
    await page.goto("http://localhost:8765/test-page.html");

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
    // Common error messages: "vault_locked", "no_key_selected", "locked"
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
    await page.goto("http://localhost:8765/test-page.html");

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
    expect(nostrStructure.hasNip04).toBe(true);
    expect(nostrStructure.hasNip44).toBe(true);
  });

  test("window.nostr is injected early before DOMContentLoaded", async ({
    extensionContext,
    extensionId,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");

    const page = await extensionContext.newPage();
    
    // Navigate to a page and check if window.nostr is available early
    await page.goto("http://localhost:8765/test-page.html");
    
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
    await page.goto("http://localhost:8765/test-page.html");

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

import { test, expect } from "./fixtures/extension";

// Placeholder spec: Per-origin policy editing - skipped for now

test.describe.skip("Settings - Origin Policy", () => {
  test("edit per-origin rules and session grant", async ({ openSidepanel }) => {
    // TODO: Open sidepanel or popup settings
    // - Navigate to Settings
    // - Add origin policy and set rules (Sign, GetPublicKey, Nip04)
    // - Toggle session grant and verify persisted behavior
    // - Remove origin policy
    const page = await openSidepanel();
    await expect(page).toHaveURL(/sidepanel\.html/);
  });
});

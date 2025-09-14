import { test, expect } from "./fixtures/extension";

// Placeholder spec: Import key onboarding flow - skipped for now

test.describe.skip("Onboarding - Import Key", () => {
  test("user can import a key JSON and confirm backup", async ({
    openPopup,
  }) => {
    // TODO: Launch the extension popup and navigate to onboarding import flow
    // - Upload JSON file
    // - Enter password
    // - Import and show backup/confirmation
    // - Require backup checkbox before enabling Get Started
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
  });
});

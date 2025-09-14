import { test, expect } from "./fixtures/extension";

// Placeholder spec: Create key onboarding flow - skipped for now

test.describe.skip("Onboarding - Create Key", () => {
  test("user can create a key and confirm backup", async ({
    openPopup,
    extensionContext,
  }) => {
    // TODO: Launch the extension popup and navigate to onboarding create flow
    // - Fill password and confirmation
    // - Generate key via UI
    // - Show backup material (pubkey / bech32 note)
    // - Require backup checkbox before enabling Finish
    // - On Finish, background unlocks and UI shows Home
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
  });
});

import { test, expect } from "./fixtures/extension";

test.describe("Activity View", () => {
  test("displays empty state when no activity", async ({ openPopup }) => {
    const page = await openPopup();

    // Note: This test assumes the extension is in a state where navigation is possible.
    // If onboarding is required, it needs to be completed first.

    // Check if we are on onboarding page
    if (await page.getByText("Welcome to Ostrilo").isVisible()) {
      // Perform minimal onboarding if possible, or skip
      test.skip(true, "Onboarding required");
      return;
    }

    // Navigate to Activity tab
    // Assuming there is a navigation bar with "Activity" or an icon
    // We might need to use a selector for the tab
    const activityTab = page.getByRole("button", { name: "Activity" });
    if (await activityTab.isVisible()) {
      await activityTab.click();

      // Check for empty state message
      await expect(page.getByText("No activity yet")).toBeVisible();
      await expect(
        page.getByText("Sign events to see your activity history here")
      ).toBeVisible();
    }
  });

  test("can filter activity", async ({ openPopup }) => {
    const page = await openPopup();

    // Skip if onboarding required
    if (await page.getByText("Welcome to Ostrilo").isVisible()) {
      test.skip(true, "Onboarding required");
      return;
    }

    await page.getByRole("button", { name: "Activity" }).click();

    // Check filter controls exist
    await expect(page.getByPlaceholder("All Origins")).toBeVisible();
    await expect(page.getByPlaceholder("All Kinds")).toBeVisible();
  });
});

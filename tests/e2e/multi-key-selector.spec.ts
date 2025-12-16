import { test, expect } from "./fixtures/extension";

/**
 * E2E tests for Multi-Key Selector functionality
 * 
 * Note: These tests are marked as skip because they require:
 * 1. Extension to be built (.output/chrome-mv3)
 * 2. Non-headless browser mode
 * 3. Manual UI interaction
 * 
 * To run: npm run test:e2e:headed
 */

test.describe.skip("Multi-Key Selector", () => {
  test("user can switch between multiple keys", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    
    // Wait for extension to load
    await expect(page).toHaveURL(/popup\.html/);
    
    // Assuming user already has multiple keys set up
    // TODO: Add onboarding setup if needed
    
    // Find and click the key selector trigger
    const keySelectorTrigger = page.getByRole("button", { name: /select active key/i });
    await expect(keySelectorTrigger).toBeVisible();
    await keySelectorTrigger.click();
    
    // Verify dropdown opens with listbox
    const keyListbox = page.getByRole("listbox", { name: /available keys/i });
    await expect(keyListbox).toBeVisible();
    
    // Verify multiple keys are shown
    const keyOptions = page.getByRole("option");
    const optionCount = await keyOptions.count();
    expect(optionCount).toBeGreaterThanOrEqual(2);
    
    // Find the currently selected key (has aria-selected=true)
    const selectedOption = page.getByRole("option", { selected: true });
    const selectedKeyName = await selectedOption.textContent();
    
    // Find a different key to switch to
    const otherOption = keyOptions.filter({ hasNot: page.getByRole("option", { selected: true }) }).first();
    const otherKeyName = await otherOption.textContent();
    
    // Click to switch keys
    await otherOption.click();
    
    // Wait for dropdown to close
    await expect(keyListbox).not.toBeVisible();
    
    // Verify the trigger now shows the newly selected key
    const updatedTrigger = page.getByRole("button", { name: /select active key/i });
    await expect(updatedTrigger).toContainText(otherKeyName || "");
    
    // Re-open dropdown to verify selection persisted
    await updatedTrigger.click();
    await expect(keyListbox).toBeVisible();
    
    const newSelectedOption = page.getByRole("option", { selected: true });
    await expect(newSelectedOption).toContainText(otherKeyName || "");
  });

  test("user can add new key via selector", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
    
    // Open key selector
    const keySelectorTrigger = page.getByRole("button", { name: /select active key/i });
    await keySelectorTrigger.click();
    
    // Wait for dropdown
    const keyListbox = page.getByRole("listbox", { name: /available keys/i });
    await expect(keyListbox).toBeVisible();
    
    // Count existing keys
    const keyOptions = page.getByRole("option");
    const initialCount = await keyOptions.count();
    
    // Click "Add Key" button
    const addKeyButton = page.getByRole("button", { name: /add new key/i });
    await expect(addKeyButton).toBeVisible();
    await addKeyButton.click();
    
    // Verify Add Key dialog opens
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Add New Key");
    
    // Choose "Create New Key"
    const createButton = page.getByRole("button", { name: /create new key/i });
    await createButton.click();
    
    // Fill in create form (simplified - assumes vault is unlocked)
    const labelInput = page.getByLabel(/label/i);
    await labelInput.fill("Test Key E2E");
    
    const generateButton = page.getByRole("button", { name: /generate/i });
    await generateButton.click();
    
    // Wait for success and dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    
    // Re-open selector and verify new key was added
    await keySelectorTrigger.click();
    await expect(keyListbox).toBeVisible();
    
    const updatedKeyOptions = page.getByRole("option");
    const finalCount = await updatedKeyOptions.count();
    expect(finalCount).toBe(initialCount + 1);
    
    // Verify new key is in the list
    const newKeyOption = page.getByRole("option", { name: /test key e2e/i });
    await expect(newKeyOption).toBeVisible();
  });

  test("user can navigate selector with keyboard", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
    
    // Focus the key selector trigger
    const keySelectorTrigger = page.getByRole("button", { name: /select active key/i });
    await keySelectorTrigger.focus();
    
    // Press Enter to open dropdown
    await page.keyboard.press("Enter");
    
    const keyListbox = page.getByRole("listbox", { name: /available keys/i });
    await expect(keyListbox).toBeVisible();
    
    // Use arrow keys to navigate
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    
    // Press Enter to select
    await page.keyboard.press("Enter");
    
    // Dropdown should close
    await expect(keyListbox).not.toBeVisible();
    
    // Test Escape key
    await keySelectorTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(keyListbox).toBeVisible();
    
    await page.keyboard.press("Escape");
    await expect(keyListbox).not.toBeVisible();
  });
});

test.describe.skip("Settings - Key Management", () => {
  test("user can rename key in settings", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
    
    // Navigate to Settings
    const settingsTab = page.getByRole("tab", { name: /settings/i });
    await settingsTab.click();
    
    // Find Keys & Identities section
    const keysSection = page.getByRole("region", { name: /keys.*identities/i });
    await expect(keysSection).toBeVisible();
    
    // Find first key's rename button
    const renameButton = keysSection.getByRole("button", { name: /rename/i }).first();
    await renameButton.click();
    
    // Input field should appear
    const labelInput = keysSection.getByRole("textbox", { name: /label/i });
    await expect(labelInput).toBeVisible();
    
    // Enter new label
    const newLabel = `Renamed Key ${Date.now()}`;
    await labelInput.fill(newLabel);
    
    // Save the change
    const saveButton = keysSection.getByRole("button", { name: /save/i });
    await saveButton.click();
    
    // Verify new label is displayed
    await expect(keysSection).toContainText(newLabel);
  });

  test("user can delete non-active key", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
    
    // Navigate to Settings
    const settingsTab = page.getByRole("tab", { name: /settings/i });
    await settingsTab.click();
    
    // Find Keys & Identities section
    const keysSection = page.getByRole("region", { name: /keys.*identities/i });
    await expect(keysSection).toBeVisible();
    
    // Count initial keys
    const keyItems = keysSection.locator("[role='group']");
    const initialCount = await keyItems.count();
    
    // Verify we have at least 2 keys (can't delete last key)
    expect(initialCount).toBeGreaterThanOrEqual(2);
    
    // Find a non-active key (one without "Active" badge)
    const nonActiveKey = keyItems.filter({ hasNot: page.getByText(/active/i) }).first();
    
    // Click delete button
    const deleteButton = nonActiveKey.getByRole("button", { name: /delete/i });
    await deleteButton.click();
    
    // Confirmation dialog should appear
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(/cannot be undone/i);
    
    // Confirm deletion
    const confirmButton = confirmDialog.getByRole("button", { name: /delete|confirm/i });
    await confirmButton.click();
    
    // Wait for dialog to close
    await expect(confirmDialog).not.toBeVisible();
    
    // Verify key count decreased
    const finalCount = await keyItems.count();
    expect(finalCount).toBe(initialCount - 1);
  });

  test("cannot delete last remaining key", async ({
    openPopup,
    extensionContext,
  }) => {
    const page = await openPopup();
    await expect(page).toHaveURL(/popup\.html/);
    
    // This test assumes starting with only 1 key
    // In a real scenario, we'd set up that state first
    
    // Navigate to Settings
    const settingsTab = page.getByRole("tab", { name: /settings/i });
    await settingsTab.click();
    
    // Find Keys & Identities section
    const keysSection = page.getByRole("region", { name: /keys.*identities/i });
    await expect(keysSection).toBeVisible();
    
    // If only 1 key exists, delete button should be disabled
    const keyItems = keysSection.locator("[role='group']");
    const count = await keyItems.count();
    
    if (count === 1) {
      const deleteButton = keysSection.getByRole("button", { name: /delete/i });
      await expect(deleteButton).toBeDisabled();
      
      // Tooltip should explain why
      await deleteButton.hover();
      const tooltip = page.getByText(/cannot delete last key/i);
      await expect(tooltip).toBeVisible();
    }
  });
});

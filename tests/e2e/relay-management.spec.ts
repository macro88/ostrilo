import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc } from "./fixtures/agent";

/**
 * Relay configuration, driven through the options UI.
 *
 * A relay is an untrusted remote party that learns which identities this
 * extension looks up, so the list of them is a privacy control and not a
 * convenience setting. Two properties are worth a browser test rather than a
 * unit test:
 *
 * - the validator the UI enforces is the same one the domain enforces. A
 *   plaintext `ws://` relay, or one carrying credentials in its URL, must be
 *   refused at the surface the user actually touches.
 * - what the UI shows and what `settings.get` returns do not drift, because the
 *   settings model is shared across popup, options and background.
 */

const RELAY_A = "wss://relay.example.com";
const RELAY_B = "wss://relay.two.example";

async function openRelaysTab(page: Page) {
  await page.getByRole("tab", { name: "Relays" }).click();
  await expect(page.getByRole("heading", { name: "Relays" })).toBeVisible();
}

async function configuredRelays(page: Page) {
  const settings = await sendExtensionRpc<{ relays: string[] }>(page, {
    type: "settings.get",
  });
  return settings.relays;
}

test.describe("relay configuration", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("adds a relay through the UI and persists it to settings", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openRelaysTab(options);

    const before = await configuredRelays(options);

    await options.getByPlaceholder("wss://relay.example.com").fill(RELAY_B);
    await options.getByRole("button", { name: "Add relay" }).click();

    // The rendered list is the claim the user believes.
    await expect(options.getByText(RELAY_B, { exact: true })).toBeVisible();

    // The stored settings are the claim the background acts on. If these two
    // ever disagree, the user is looking at a lie.
    await expect
      .poll(async () => await configuredRelays(options))
      .toContain(RELAY_B);

    const after = await configuredRelays(options);
    expect(after.length).toBe(before.length + 1);
  });

  test("removes a relay through the UI and persists the removal", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openRelaysTab(options);

    await options.getByPlaceholder("wss://relay.example.com").fill(RELAY_B);
    await options.getByRole("button", { name: "Add relay" }).click();
    await expect(options.getByText(RELAY_B, { exact: true })).toBeVisible();

    await options.getByRole("button", { name: `Remove ${RELAY_B}` }).click();

    await expect(options.getByText(RELAY_B, { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => await configuredRelays(options))
      .not.toContain(RELAY_B);
  });

  /**
   * The rule is `wss:` only, with no credentials in the URL. A plaintext relay
   * is one an on-path attacker can read and rewrite, and a URL carrying a
   * username or password puts a secret somewhere it will be logged.
   */
  test("refuses a relay the domain validator rejects", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openRelaysTab(options);

    const before = await configuredRelays(options);
    const input = options.getByPlaceholder("wss://relay.example.com");
    const addButton = options.getByRole("button", { name: "Add relay" });

    for (const rejected of [
      "ws://relay.example.com", // plaintext
      "https://relay.example.com", // not a websocket
      "wss://user:secret@relay.example.com", // credentials in the URL
      "not a url at all",
    ]) {
      await input.fill(rejected);
      await addButton.click();

      await expect(
        options.getByRole("alert"),
        `"${rejected}" was accepted by the UI`
      ).toBeVisible();
      await expect(options.getByText(rejected, { exact: true })).toHaveCount(0);
    }

    // Nothing above reached storage.
    expect(await configuredRelays(options)).toEqual(before);
  });

  test("refuses an empty entry and a duplicate", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openRelaysTab(options);

    const input = options.getByPlaceholder("wss://relay.example.com");
    const addButton = options.getByRole("button", { name: "Add relay" });

    await addButton.click();
    await expect(
      options.getByText("Enter a relay URL before adding it.")
    ).toBeVisible();

    await input.fill(RELAY_A);
    await addButton.click();
    await expect(options.getByText(RELAY_A, { exact: true })).toBeVisible();

    await input.fill(RELAY_A);
    await addButton.click();
    await expect(
      options.getByText("That relay is already in the list.")
    ).toBeVisible();

    // Added once, not twice.
    const relays = await configuredRelays(options);
    expect(relays.filter((r) => r === RELAY_A)).toHaveLength(1);
  });

  /**
   * The count is a privacy statement, not decoration: with one relay, that
   * relay sees every identity the extension looks up. The copy has to track
   * the actual configuration or it misleads about what is being disclosed.
   */
  test("tells the truth about how many relays see your lookups", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openRelaysTab(options);

    const single = /that relay sees every identity/i;
    const spread = /spread across these relays/i;

    const relays = await configuredRelays(options);
    for (const relay of relays.slice(1)) {
      await options.getByRole("button", { name: `Remove ${relay}` }).click();
    }
    await expect.poll(async () => (await configuredRelays(options)).length).toBe(1);
    await expect(options.getByText(single)).toBeVisible();

    await options.getByPlaceholder("wss://relay.example.com").fill(RELAY_B);
    await options.getByRole("button", { name: "Add relay" }).click();
    await expect(options.getByText(RELAY_B, { exact: true })).toBeVisible();
    await expect(options.getByText(spread)).toBeVisible();
  });
});

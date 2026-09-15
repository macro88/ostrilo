import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  grantKindAllow,
  openDapp,
  DAPP_ORIGIN,
} from "./fixtures/agent";

/**
 * The activity log's retention limit, and what it destroys.
 *
 * The log is the only record a user has of what their key signed and for whom.
 * "Max entries to keep" is therefore not a performance setting: lowering it
 * silently deletes audit evidence, permanently, with no confirmation and no
 * password. Nothing tested it.
 *
 * Two properties matter and are asserted here. The buffer must discard the
 * OLDEST entries, never the newest — a ring buffer that rotated the wrong way
 * would quietly keep the history nobody needs and drop the signature the user
 * is trying to investigate. And whatever remains must still be the truth: the
 * count the UI reports has to match what `activity.getRecent` can actually
 * return.
 */

const RETENTION_LABEL = "Max entries to keep";

async function openActivityLogTab(page: Page) {
  await page.getByRole("tab", { name: "Activity Log" }).click();
  await expect(page.getByLabel(RETENTION_LABEL)).toBeVisible();
}

async function recent(page: Page, limit = 100) {
  return await sendExtensionRpc<{
    entries: Array<{ contentPreview?: string; kind?: number; decision?: string }>;
    total: number;
  }>(page, { type: "activity.getRecent", limit });
}

/**
 * Signs `count` distinct events through the dApp, oldest first, labelling each
 * from `start`. The offset is not decoration: a second call that restarted at
 * zero would reuse a label already in the log and make an ordering assertion
 * read a stale entry as the new one.
 */
async function signSeries(
  dapp: Page,
  count: number,
  start = 0
): Promise<void> {
  for (let i = start; i < start + count; i += 1) {
    await dapp.evaluate(
      (marker) =>
        window.testSignEvent({
          kind: 7,
          content: marker,
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        }),
      `entry-${String(i).padStart(2, "0")}`
    );
  }
}

test.describe("activity log retention", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== "chromium", "Extension tests only run on Chromium");
  });

  test("keeps the newest entries and discards the oldest", async ({
    openPopup,
    openOptions,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    const dapp = await openDapp(extensionContext);
    // Twelve is above the floor the retention slider allows (min 10), so the
    // rotation is observable without waiting on hundreds of signatures.
    await signSeries(dapp, 12);

    await expect.poll(async () => (await recent(popup)).total).toBe(12);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openActivityLogTab(options);

    // Drag the retention floor down to its minimum of 10.
    await sendExtensionRpc(options, {
      type: "settings.update",
      patch: { maxActivityEntries: 10 },
    });

    // Rotation happens as entries are recorded, so provoke it with one more.
    await signSeries(dapp, 1, 12);

    await expect.poll(async () => (await recent(popup)).total).toBeLessThanOrEqual(10);

    const kept = await recent(popup);
    // `contentPreview`, not `content`: the log deliberately stores a preview
    // rather than the signed payload. Asserting on `content` would read
    // undefined on every entry and pass regardless of what was kept, which is
    // how a retention test ends up proving nothing.
    const previews = kept.entries.map((e) => e.contentPreview ?? "");
    expect(previews.length).toBe(10);

    // Newest first, so the survivors must be the tail of what was signed. The
    // oldest entries are the ones that go; a buffer rotating the other way
    // would keep the history nobody needs and drop the signature the user is
    // trying to investigate.
    expect(previews).toContain("entry-12");
    expect(previews).not.toContain("entry-00");
    expect(previews).not.toContain("entry-01");
    expect(previews).not.toContain("entry-02");
  });

  test("the retention control is reachable by its name", async ({
    openPopup,
    openOptions,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);

    const options = await openOptions();
    await options.setViewportSize({ width: 1280, height: 900 });
    await openActivityLogTab(options);

    // Regression guard for a fix made alongside this file: the slider had a
    // visible <Label> that named nothing, because Radix puts `role="slider"` on
    // the Thumb. A control that decides how much audit history survives should
    // not be anonymous to a screen reader.
    const slider = options.getByRole("slider", { name: RETENTION_LABEL });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute("aria-valuenow", /\d+/);
  });

  test("clearing the log empties it and says so", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await seedUnlockedVault(popup);
    await grantKindAllow(popup, DAPP_ORIGIN, 7);

    const dapp = await openDapp(extensionContext);
    await signSeries(dapp, 3);
    await expect.poll(async () => (await recent(popup)).total).toBe(3);

    await sendExtensionRpc(popup, { type: "activity.clear" });

    await expect.poll(async () => (await recent(popup)).total).toBe(0);

    await popup.getByRole("button", { name: "Activity" }).click();
    await expect(popup.getByText("No activity yet")).toBeVisible();
  });
});

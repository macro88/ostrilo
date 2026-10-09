import fs from "node:fs/promises";
import path from "node:path";

import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { seedUnlockedVault, sendExtensionRpc } from "./fixtures/agent";
import { PROFILE_FIELD_BOUNDS } from "@/domain/profile/types";

/**
 * Long profile values must never widen the window.
 *
 * A toolbar popup has no width of its own: Chrome sizes it to the document's
 * preferred width, up to 800px. `truncate` and `overflow-hidden` shorten what
 * is painted but not what a flex row reports as its max-content width, so one
 * unbroken Blossom URL in a profile row used to push the whole popup out to
 * its maximum and leave two vertical scrollbars behind it. A tab with a preset
 * viewport cannot show that, because a tab's width is fixed from outside - so
 * these tests measure the preferred width directly (see `preferredWidth`) in
 * addition to the horizontal overflow a tab can show.
 *
 * To cover a new long value, add a field to `LONG_PROFILE` (or a surface to
 * `SURFACES`); every assertion below runs over the whole record.
 */

const UNREACHABLE_RELAY = "wss://relay.ostrilo-e2e.invalid";

/** 64 hex characters, the shape of a Blossom blob hash. */
const BLOB_HASH = "f747f2dc9c53074bc78ab5ac5d43c11cc47fb5c2b50c10acc0691d4a8e7e1c3a";

/**
 * Unbroken, so the browser has no break opportunity inside it. Over 300
 * characters, and under the 512 the profile schema accepts.
 */
const LONG_PICTURE_URL = `https://cdn.blossom-fixture.invalid/${BLOB_HASH}${BLOB_HASH}${BLOB_HASH}${BLOB_HASH}.webp?size=originalsizeoriginalsize`;
const LONG_WEBSITE_URL = `https://${"a-very-long-subdomain-".repeat(8)}example.invalid/${"path".repeat(30)}`;
const LONG_DISPLAY_NAME = "W".repeat(50);
const LONG_USERNAME = "u".repeat(50);
const LONG_ABOUT = `${"Unbrokenaboutwordwithnospaces".repeat(6)} then a normal sentence follows it. `.repeat(
  2
);
const LONG_NIP05 = `${"nip05localpart".repeat(8)}@${"domain".repeat(10)}.invalid`;
const LONG_LUD16 = `${"lightninglocal".repeat(8)}@${"wallet".repeat(10)}.invalid`;

/** Every long value the profile surfaces show. Add a field here to cover it. */
const LONG_PROFILE: Record<string, string> = {
  display_name: LONG_DISPLAY_NAME,
  name: LONG_USERNAME,
  about: LONG_ABOUT,
  picture: LONG_PICTURE_URL,
  banner: LONG_PICTURE_URL,
  website: LONG_WEBSITE_URL,
  nip05: LONG_NIP05,
  lud16: LONG_LUD16,
};

const SURFACES = [
  { name: "popup", page: "popup.html", viewport: { width: 400, height: 600 } },
  {
    name: "side panel",
    page: "sidepanel.html",
    viewport: { width: 400, height: 800 },
  },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * Pixel slack for sub-pixel rounding. Overflow caused by content is hundreds
 * of pixels, so a couple does not hide a real regression.
 */
const ROUNDING = 2;

interface LayoutMeasure {
  clientWidth: number;
  scrollWidth: number;
  /**
   * Width the document asks for when nothing constrains it. A toolbar popup is
   * sized to exactly this, capped at 800px, so it is what the popup's width is.
   */
  preferredWidth: number;
  documentScrolls: boolean;
  /**
   * Elements painted past the right edge. Containers that clip (`overflow
   * hidden`) hide the overhang from `scrollWidth`, so this is the only measure
   * that sees text running out of its card.
   */
  overhanging: string[];
  /** Elements that scroll vertically right now, other than the document. */
  scrollers: string[];
}

async function measureLayout(page: Page): Promise<LayoutMeasure> {
  return await page.evaluate(() => {
    const root = document.documentElement;

    const previousWidth = root.style.width;
    root.style.width = "max-content";
    const preferredWidth = Math.ceil(root.getBoundingClientRect().width);
    root.style.width = previousWidth;

    const scrollers: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll";
      // A textarea scrolls its own text; it is a control, not a surface.
      if (element.tagName === "TEXTAREA") continue;
      if (scrollsY && element.scrollHeight > element.clientHeight + 1) {
        scrollers.push(element.tagName.toLowerCase());
      }
    }

    const overhanging: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      if (element.getBoundingClientRect().right > root.clientWidth + 2) {
        overhanging.push(`${element.tagName.toLowerCase()}.${element.className}`.slice(0, 60));
      }
    }

    return {
      overhanging,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      preferredWidth,
      documentScrolls: root.scrollHeight > root.clientHeight + 1,
      scrollers,
    };
  });
}

async function seedLongProfile(page: Page): Promise<void> {
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { relays: [UNREACHABLE_RELAY] },
  });
  const keys = await sendExtensionRpc<Array<{ pubkey: string }>>(page, {
    type: "keys.list",
  });
  await page.evaluate(
    async ({ pubkey, metadata }) => {
      const chromeApi = (globalThis as any).chrome;
      const current = await chromeApi.storage.session.get("profileCache");
      const cache = current.profileCache ?? {};
      cache[pubkey] = {
        pubkey,
        metadata,
        fetchedAt: Math.floor(Date.now() / 1000),
        ttl: 3600,
      };
      await chromeApi.storage.session.set({ profileCache: cache });
    },
    { pubkey: keys[0].pubkey, metadata: LONG_PROFILE }
  );
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await sendExtensionRpc(page, { type: "settings.update", patch: { theme } });
  await page.reload();
  await expect(page.locator("html")).toHaveClass(
    theme === "dark" ? /dark/ : /^(?!.*dark).*$/
  );
}

/** Where `OSTRILO_LAYOUT_SHOT_DIR` is set, keep the capture; otherwise skip it. */
async function capture(page: Page, name: string): Promise<void> {
  const dir = process.env.OSTRILO_LAYOUT_SHOT_DIR;
  if (!dir) return;
  const target = path.resolve(dir);
  await fs.mkdir(target, { recursive: true });
  await page.screenshot({
    path: path.join(target, `${name}.png`),
    animations: "disabled",
  });
}

function expectContained(
  measure: LayoutMeasure,
  baselineWidth: number,
  where: string
): void {
  expect.soft(
    measure.scrollWidth,
    `${where}: horizontal overflow`
  ).toBeLessThanOrEqual(measure.clientWidth + ROUNDING);
  expect.soft(
    measure.preferredWidth,
    `${where}: preferred width grew from ${baselineWidth}px`
  ).toBeLessThanOrEqual(baselineWidth + ROUNDING);
  expect.soft(
    measure.overhanging,
    `${where}: elements run past the right edge`
  ).toEqual([]);
  expect.soft(measure.documentScrolls, `${where}: the document scrolls`).toBe(false);
  expect.soft(
    measure.scrollers.length,
    `${where}: more than one scrolling container (${measure.scrollers.join(", ")})`
  ).toBeLessThanOrEqual(1);
}

test.describe("long profile values stay inside the window", () => {
  test.describe.configure({ timeout: 120_000 });

  test("fixtures are long enough to matter and short enough to be valid", () => {
    expect(LONG_PICTURE_URL.length).toBeGreaterThanOrEqual(300);
    expect(LONG_PICTURE_URL.length).toBeLessThanOrEqual(PROFILE_FIELD_BOUNDS.URL);
    expect(LONG_ABOUT.length).toBeLessThanOrEqual(PROFILE_FIELD_BOUNDS.ABOUT);
    expect(LONG_DISPLAY_NAME.length).toBeLessThanOrEqual(
      PROFILE_FIELD_BOUNDS.DISPLAY_NAME
    );
  });

  for (const surface of SURFACES) {
    test(`${surface.name}: profile view and editor`, async ({
      extensionContext,
      extensionId,
    }) => {
      const page = await extensionContext.newPage();
      await page.setViewportSize(surface.viewport);
      await page.goto(`chrome-extension://${extensionId}/${surface.page}`);
      await seedUnlockedVault(page, { label: "Long Value Key" });

      await page.getByRole("button", { name: "Profile" }).click();
      await expect(
        page.getByRole("heading", { name: "Profile Settings" })
      ).toBeVisible();
      // No cached profile yet: this is the baseline the long one is held to.
      await expect(
        page.getByRole("button", { name: "Add Picture URL" })
      ).toBeVisible({ timeout: 15_000 });
      const baseline = await measureLayout(page);

      await seedLongProfile(page);

      for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.getByRole("button", { name: "Profile" }).click();
        // Measured only once the published values are in: a skeleton row is
        // narrow, so a measurement taken while loading proves nothing.
        await expect(
          page.getByRole("button", { name: "Edit Profile" })
        ).toBeEnabled({ timeout: 15_000 });
        await expect(page.getByText(LONG_ABOUT.trim())).toBeVisible();

        const view = await measureLayout(page);
        await capture(page, `${surface.name}-${theme}-view`);
        expectContained(view, baseline.preferredWidth, `${surface.name} ${theme} view`);

        // Reachable: the action row is on screen without scrolling the page.
        await expect(
          page.getByRole("button", { name: "Edit Profile" })
        ).toBeInViewport();
        // The row scrolls into reach; its actions are on screen beside the
        // label, not pushed past the right edge by the value.
        await page
          .getByRole("button", { name: "Copy Picture URL" })
          .scrollIntoViewIfNeeded();
        await capture(page, `${surface.name}-${theme}-picture-row`);
        await expect(
          page.getByRole("button", { name: "Copy Picture URL" })
        ).toBeInViewport({ ratio: 1 });
        await expect(
          page.getByRole("button", { name: "Open picture in a new tab" })
        ).toBeInViewport({ ratio: 1 });

        await page.getByRole("button", { name: "Edit Profile" }).click();
        const picture = page.getByLabel("Profile Picture URL");
        await expect(picture).toBeVisible();
        // The field holds the exact value; only its visible label is shortened.
        await expect(picture).toHaveValue(LONG_PICTURE_URL);

        const editing = await measureLayout(page);
        await capture(page, `${surface.name}-${theme}-edit`);
        expectContained(editing, baseline.preferredWidth, `${surface.name} ${theme} edit`);

        // Typing a long value is the moment the report describes.
        await picture.fill(`${LONG_PICTURE_URL}typedmoretypedmore`);
        expectContained(
          await measureLayout(page),
          baseline.preferredWidth,
          `${surface.name} ${theme} edit while typing`
        );

        await expect(
          page.getByRole("button", { name: "Save Changes" })
        ).toBeInViewport();
        await expect(page.getByRole("button", { name: "Cancel" })).toBeInViewport();

        await page.getByRole("button", { name: "Cancel" }).click();
        await expect(
          page.getByRole("heading", { level: 3, name: "Picture URL" })
        ).toBeVisible();
      }
    });
  }

  test("copy returns the exact picture URL, not the shortened label", async ({
    extensionContext,
    extensionId,
  }) => {
    const page = await extensionContext.newPage();
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await seedUnlockedVault(page, { label: "Copy Value Key" });
    await seedLongProfile(page);
    await page.reload();
    await page.getByRole("button", { name: "Profile" }).click();

    const copied = await page.evaluate(() => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      (window as any).__copied = null;
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (text: string) => {
          (window as any).__copied = text;
          return original(text).catch(() => undefined);
        },
      });
      return true;
    });
    expect(copied).toBe(true);

    await page.getByRole("button", { name: "Copy Picture URL" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__copied))
      .toBe(LONG_PICTURE_URL);
  });
});

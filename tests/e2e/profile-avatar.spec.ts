import type { BrowserContext, Request } from "@playwright/test";

import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import {
  seedUnlockedVault,
  sendExtensionRpc,
  TEST_PASSWORD,
} from "./fixtures/agent";
import { FixtureRelay } from "./fixtures/fixture-relay";
import { ImageHost } from "./fixtures/image-host";
import { twoToneImage } from "./fixtures/png";

/**
 * The user's own picture in the header, from a local copy.
 *
 * The policy under test has two halves, and both are asserted from the
 * browser's own network log rather than from the code:
 *
 *  - The Profile page loads the picture exactly when the user asks: once per
 *    profile save that carries a picture, and once per press of Refresh
 *    picture. Never on a retry, never in the background.
 *  - Nothing else loads an image. Opening the popup or the side panel,
 *    unlocking, and switching keys all render the stored `data:` copy, so the
 *    image host sees no request from any of them.
 *
 * The image host is a real HTTPS server on localhost (see `ImageHost`), so
 * nothing leaves the machine and its request log is the browser's own traffic.
 */

const RED = [220, 30, 30] as const;
const BLUE = [30, 30, 220] as const;
const GREEN = [30, 200, 60] as const;

/** Landscape, left half red and right half blue: a centre crop keeps both. */
const LANDSCAPE = twoToneImage(200, 100, RED, BLUE);
/** One pixel over the 4096 limit, and a few hundred bytes on the wire. */
const OVERSIZE = twoToneImage(4097, 1, GREEN);

const IMAGES: Record<string, Buffer> = {
  "/landscape.png": LANDSCAPE,
  "/oversize.png": OVERSIZE,
};

const HEADER_IMAGE = "header img";

type Key = { id: string; label?: string; pubkey: string };

const openRelays: FixtureRelay[] = [];

test.afterEach(async () => {
  await Promise.all([
    ...openRelays.splice(0).map((relay) => relay.stop()),
    ...hosts.splice(0).map((host) => host.stop()),
  ]);
});

const hosts: ImageHost[] = [];

async function startImageHost(): Promise<ImageHost> {
  const host = new ImageHost(IMAGES);
  await host.start();
  hosts.push(host);
  return host;
}

/**
 * Every image request that is not a `data:` URL or an extension file, across
 * the whole browser context.
 */
function recordRemoteImageRequests(context: BrowserContext): Request[] {
  const seen: Request[] = [];
  context.on("request", (request) => {
    const url = request.url();
    const isRemote = url.startsWith("https://") || url.startsWith("http://");
    if (request.resourceType() === "image" && isRemote) seen.push(request);
  });
  return seen;
}

const urls = (requests: Request[]) => requests.map((request) => request.url());

/**
 * Two keys in one vault, the fixture relay in front of the public default, and
 * the popup on Home with the first key selected.
 */
async function arrive(page: Page): Promise<{ first: Key; second: Key; relay: FixtureRelay }> {
  const relay = new FixtureRelay({ accepts: true });
  await relay.start();
  openRelays.push(relay);

  // The background initialises its settings record inside the first read, and
  // that initialisation is a write; see `arriveAtProfile` in profile-edit.spec.
  await sendExtensionRpc(page, { type: "settings.get" });
  await page.evaluate(async (url) => {
    await (globalThis as any).chrome.storage.local.set({
      appSettings: { relays: [url] },
    });
  }, relay.url);

  await seedUnlockedVault(page, { label: "Avatar Key A" });
  await sendExtensionRpc(page, {
    type: "settings.update",
    patch: { relays: [relay.url] },
  });
  await sendExtensionRpc(page, {
    type: "vault.generate",
    password: TEST_PASSWORD,
    label: "Avatar Key B",
  });
  // Only an unlock puts every key into the vault's memory.
  await sendExtensionRpc(page, { type: "vault.lock" });
  await sendExtensionRpc(page, { type: "vault.unlock", password: TEST_PASSWORD });

  const keys = await sendExtensionRpc<Key[]>(page, { type: "keys.list" });
  const first = keys.find((k) => k.label === "Avatar Key A")!;
  const second = keys.find((k) => k.label === "Avatar Key B")!;
  expect(first && second).toBeTruthy();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 2, name: "Avatar Key A" })
  ).toBeVisible({ timeout: 15_000 });
  return { first, second, relay };
}

/** The profile cache entry the Profile page reads before it asks a relay. */
async function seedPicture(page: Page, pubkey: string, picture: string) {
  await page.evaluate(
    async ({ pubkey: key, picture: url }) => {
      const chromeApi = (globalThis as any).chrome;
      const current = await chromeApi.storage.session.get("profileCache");
      const cache = current.profileCache ?? {};
      cache[key] = {
        pubkey: key,
        metadata: { picture: url },
        fetchedAt: Math.floor(Date.now() / 1000),
        ttl: 3600,
      };
      await chromeApi.storage.session.set({ profileCache: cache });
    },
    { pubkey, picture }
  );
}

async function openProfile(page: Page) {
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
}

const note = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

type StoredAvatar = { pubkey: string; dataUrl: string; sourceUrl: string; at: number } | null;
async function storedAvatar(page: Page, pubkey: string): Promise<StoredAvatar> {
  const { avatar } = await sendExtensionRpc<{ avatar: StoredAvatar }>(page, {
    type: "avatar.get",
    pubkey,
  });
  return avatar;
}

/** The colour of one pixel of an `<img>`, read through a canvas. */
async function pixelOf(page: Page, selector: string, x: number, y: number) {
  return page.evaluate(
    ({ selector: sel, x: px, y: py }) => {
      const img = document.querySelector<HTMLImageElement>(sel)!;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(px, py, 1, 1).data.slice(0, 3));
    },
    { selector, x, y }
  );
}

function expectNear(actual: number[], expected: readonly number[]) {
  actual.forEach((channel, i) => {
    expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(60);
  });
}

async function selectKey(page: Page, label: string) {
  await page.getByRole("button", { name: "Select active key" }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${label} - `) }).click();
  await expect(page.getByRole("heading", { level: 2, name: label })).toBeVisible();
}

test.describe("own profile picture in the header", () => {
  test.describe.configure({ timeout: 120_000 });

  test("saving a profile loads the picture once and the header shows a 96px centre-cropped copy", async ({
    openPopup,
    extensionContext,
  }) => {
    const host = await startImageHost();
    const remote = recordRemoteImageRequests(extensionContext);
    const popup = await openPopup();
    const { first } = await arrive(popup);
    await expect(popup.locator(HEADER_IMAGE)).toHaveCount(0);

    await openProfile(popup);
    await popup.getByRole("button", { name: "Add Picture URL" }).click();
    await popup.getByLabel("Profile Picture URL").fill(host.url("/landscape.png"));
    await popup.getByRole("button", { name: "Save Changes" }).click();

    const header = popup.locator(HEADER_IMAGE);
    await expect(header).toHaveAttribute("src", /^data:image\/(webp|png);base64,/, {
      timeout: 20_000,
    });
    await expect(popup.getByRole("status")).toHaveText(
      "The header now shows this picture."
    );

    // One request, anonymous, with no referrer.
    expect(urls(remote)).toEqual([host.url("/landscape.png")]);
    expect(host.requests).toHaveLength(1);
    expect(host.requests[0].headers.referer).toBeUndefined();
    expect(host.requests[0].headers.origin).toMatch(/^chrome-extension:\/\//);

    // The header image is a 96x96 copy shown in a fixed 28px box.
    const dims = await header.evaluate((img: HTMLImageElement) => ({
      natural: [img.naturalWidth, img.naturalHeight],
      box: [img.getBoundingClientRect().width, img.getBoundingClientRect().height],
      alt: img.alt,
    }));
    expect(dims.natural).toEqual([96, 96]);
    expect(dims.box).toEqual([28, 28]);
    expect(dims.alt).toBe("Avatar Key A");

    // Once the picture is up the seal's initial is gone, so a transparent
    // picture is shown as made.
    await expect(popup.locator("header .seal")).not.toContainText("A");

    // Centre crop of 200x100: the middle square keeps the red/blue boundary.
    expectNear(await pixelOf(popup, HEADER_IMAGE, 20, 48), RED);
    expectNear(await pixelOf(popup, HEADER_IMAGE, 76, 48), BLUE);

    const stored = await storedAvatar(popup, first.pubkey);
    expect(stored).toMatchObject({
      pubkey: first.pubkey,
      sourceUrl: host.url("/landscape.png"),
    });
    expect(stored!.dataUrl).toMatch(/^data:image\/(webp|png);base64,/);
    expect(stored!.dataUrl.length).toBeLessThanOrEqual(64 * 1024);
  });

  test("reopening, unlocking, the side panel and switching keys make no image request, and never show another key's picture", async ({
    openPopup,
    openSidepanel,
    extensionContext,
  }) => {
    const host = await startImageHost();
    const remote = recordRemoteImageRequests(extensionContext);
    const popup = await openPopup();
    const { first, second } = await arrive(popup);

    await seedPicture(popup, first.pubkey, host.url("/landscape.png"));
    await popup.reload();
    await openProfile(popup);
    await popup.getByRole("button", { name: "Refresh picture" }).click();
    await expect(popup.locator(HEADER_IMAGE)).toBeVisible({ timeout: 20_000 });
    const loadedOnce = urls(remote);
    expect(loadedOnce).toEqual([host.url("/landscape.png")]);

    // Reopen, and lock and unlock: the copy is read from storage.
    await sendExtensionRpc(popup, { type: "vault.lock" });
    await sendExtensionRpc(popup, { type: "vault.unlock", password: TEST_PASSWORD });
    await popup.reload();
    await expect(popup.locator(HEADER_IMAGE)).toBeVisible({ timeout: 15_000 });

    // Switching to a key with no copy shows its seal at once. Any image that
    // appears in the header while it happens is recorded.
    await popup.evaluate(() => {
      (window as any).__headerImages = [];
      new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.matches("img, :has(img)")) {
              (window as any).__headerImages.push(node.outerHTML.slice(0, 80));
            }
          });
        }
      }).observe(document.querySelector("header")!, { childList: true, subtree: true });
    });
    await selectKey(popup, "Avatar Key B");
    await expect(popup.locator(HEADER_IMAGE)).toHaveCount(0);
    expect(await popup.evaluate(() => (window as any).__headerImages)).toEqual([]);
    expect(await storedAvatar(popup, second.pubkey)).toBeNull();

    await selectKey(popup, "Avatar Key A");
    await expect(popup.locator(HEADER_IMAGE)).toBeVisible();

    const sidepanel = await openSidepanel();
    await expect(sidepanel.locator(HEADER_IMAGE)).toHaveAttribute(
      "src",
      /^data:image\//,
      { timeout: 15_000 }
    );

    expect(urls(remote), "no request after the explicit refresh").toEqual(loadedOnce);
    expect(host.requests).toHaveLength(1);
  });

  test("each key keeps its own picture, shown from the stored data: copy with no request at all", async ({
    openPopup,
    extensionContext,
  }) => {
    const remote = recordRemoteImageRequests(extensionContext);
    const popup = await openPopup();
    const { first, second } = await arrive(popup);

    const asDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
    const redCopy = asDataUrl(twoToneImage(96, 96, RED));
    const blueCopy = asDataUrl(twoToneImage(96, 96, BLUE));
    for (const [key, dataUrl] of [
      [first, redCopy],
      [second, blueCopy],
    ] as const) {
      await sendExtensionRpc(popup, {
        type: "avatar.save",
        pubkey: key.pubkey,
        sourceUrl: "https://avatars.example/seeded.png",
        dataUrl,
      });
    }

    await popup.reload();
    await expect(popup.locator(HEADER_IMAGE)).toHaveAttribute("src", redCopy, {
      timeout: 15_000,
    });
    await selectKey(popup, "Avatar Key B");
    await expect(popup.locator(HEADER_IMAGE)).toHaveAttribute("src", blueCopy);
    await selectKey(popup, "Avatar Key A");
    await expect(popup.locator(HEADER_IMAGE)).toHaveAttribute("src", redCopy);

    expect(urls(remote)).toEqual([]);
  });

  test("a picture that cannot be loaded keeps the seal, says so, and is not asked again", async ({
    openPopup,
    extensionContext,
  }) => {
    const host = await startImageHost();
    const remote = recordRemoteImageRequests(extensionContext);
    const popup = await openPopup();
    const { first } = await arrive(popup);

    await seedPicture(popup, first.pubkey, host.url("/missing.png"));
    await popup.reload();
    await openProfile(popup);
    await popup.getByRole("button", { name: "Refresh picture" }).click();

    await expect(note(popup)).toHaveText(
      "Ostrilo couldn't load this picture to keep a copy, so the header shows your seal.",
      { timeout: 20_000 }
    );
    await expect(popup.locator(HEADER_IMAGE)).toHaveCount(0);
    expect(await storedAvatar(popup, first.pubkey)).toBeNull();

    // No background retry.
    await popup.waitForTimeout(2_000);
    expect(urls(remote)).toEqual([host.url("/missing.png")]);
    expect(host.requests).toHaveLength(1);
  });

  test("an image over 4096 pixels is refused with a note and no copy", async ({ openPopup }) => {
    const host = await startImageHost();
    const popup = await openPopup();
    const { first } = await arrive(popup);

    await seedPicture(popup, first.pubkey, host.url("/oversize.png"));
    await popup.reload();
    await openProfile(popup);
    await popup.getByRole("button", { name: "Refresh picture" }).click();

    await expect(note(popup)).toHaveText(
      "This image is too large for Ostrilo to keep a copy.",
      { timeout: 20_000 }
    );
    await expect(popup.locator(HEADER_IMAGE)).toHaveCount(0);
    expect(await storedAvatar(popup, first.pubkey)).toBeNull();
  });

  test("saving a profile without a picture removes the copy", async ({ openPopup }) => {
    const host = await startImageHost();
    const popup = await openPopup();
    const { first } = await arrive(popup);

    await seedPicture(popup, first.pubkey, host.url("/landscape.png"));
    await popup.reload();
    await openProfile(popup);
    await popup.getByRole("button", { name: "Refresh picture" }).click();
    await expect(popup.locator(HEADER_IMAGE)).toBeVisible({ timeout: 20_000 });

    await popup.getByRole("button", { name: "Edit Profile" }).click();
    await popup.getByRole("button", { name: "Remove" }).click();
    await popup.getByRole("button", { name: "Save Changes" }).click();

    await expect(popup.locator(HEADER_IMAGE)).toHaveCount(0, { timeout: 20_000 });
    expect(await storedAvatar(popup, first.pubkey)).toBeNull();
  });

  test("deleting a key removes its copy and leaves the other key's", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    const { first, second } = await arrive(popup);

    const copy = `data:image/png;base64,${twoToneImage(96, 96, GREEN).toString("base64")}`;
    for (const key of [first, second]) {
      await sendExtensionRpc(popup, {
        type: "avatar.save",
        pubkey: key.pubkey,
        sourceUrl: "https://avatars.example/seeded.png",
        dataUrl: copy,
      });
    }

    await sendExtensionRpc(popup, {
      type: "vault.deleteKey",
      id: second.id,
      password: TEST_PASSWORD,
    });

    expect(await storedAvatar(popup, second.pubkey)).toBeNull();
    expect(await storedAvatar(popup, first.pubkey)).not.toBeNull();
  });

  test("the background refuses a copy that is not a png or webp data URL, or is for no vault key", async ({
    openPopup,
  }) => {
    const popup = await openPopup();
    const { first } = await arrive(popup);

    const attempt = (over: Record<string, string>) =>
      sendExtensionRpc(popup, {
        type: "avatar.save",
        pubkey: first.pubkey,
        sourceUrl: "https://avatars.example/x.png",
        dataUrl: `data:image/png;base64,${twoToneImage(8, 8, RED).toString("base64")}`,
        ...over,
      });

    await expect(attempt({ dataUrl: "https://avatars.example/x.png" })).rejects.toThrow();
    await expect(
      attempt({ dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" })
    ).rejects.toThrow();
    await expect(attempt({ sourceUrl: "http://avatars.example/x.png" })).rejects.toThrow();
    await expect(attempt({ pubkey: "e".repeat(64) })).rejects.toThrow();
    expect(await storedAvatar(popup, first.pubkey)).toBeNull();
  });
});

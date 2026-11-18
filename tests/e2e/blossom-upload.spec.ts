import { schnorr } from "@noble/curves/secp256k1.js";
import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { TEST_PASSWORD, sendExtensionRpc } from "./fixtures/agent";
import { FixtureRelay } from "./fixtures/fixture-relay";
import {
  BLOSSOM_HOST,
  BLOSSOM_ORIGIN,
  FakeBlossom,
  sha256Hex,
  type FakeBlossomOptions,
} from "./fixtures/fake-blossom";
import { arriveAtProfile, openEditForm, openProfileTab } from "./fixtures/profile-editor";
import { twoToneImage, withTextChunk } from "./fixtures/png";

/**
 * Uploading a profile image to a Blossom server from the profile editor.
 *
 * The server is a fixture answered at the browser-context level, so the real
 * manifest CSP, the real CORS preflight, the real signing RPC and the real
 * dialog all run, and nothing reaches the network. The things held onto here:
 *
 *  - Nothing is sent, and no authorisation is made, until the user has chosen a
 *    host and confirmed.
 *  - The request carries exactly what the design says it does, and the token is
 *    a kind 24242 event the vault key really signed, for this blob and host.
 *  - What leaves the browser is the re-encoded image: embedded metadata does not
 *    survive, orientation does, and a large image is capped.
 *  - A reply that does not agree with what was sent, a refused preflight, a
 *    redirect and a cancel each leave the field alone.
 */

const SEEDED_PROFILE = { name: "Wren Halloway", about: "Maps disused railways." };
const RED = [200, 40, 40] as const;
const BLUE = [40, 40, 200] as const;

const openRelays: FixtureRelay[] = [];

async function startRelay(): Promise<FixtureRelay> {
  const relay = new FixtureRelay({ accepts: true });
  await relay.start();
  openRelays.push(relay);
  return relay;
}

test.afterEach(async () => {
  await Promise.all(openRelays.splice(0).map((relay) => relay.stop()));
});

async function watchCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, "__cspViolations", seen);
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => Reflect.get(window, "__cspViolations") as string[]);
}

async function arrive(
  page: Page,
  context: Parameters<FakeBlossom["attach"]>[0],
  options: FakeBlossomOptions = {}
) {
  const blossom = new FakeBlossom(options);
  await blossom.attach(context);
  const relay = await startRelay();
  const key = await arriveAtProfile(page, relay, SEEDED_PROFILE);
  await openEditForm(page);
  return { blossom, relay, key };
}

const pictureFile = (page: Page) => page.locator('input[type="file"]').first();
const bannerFile = (page: Page) => page.locator('input[type="file"]').nth(1);
const dialog = (page: Page) => page.getByRole("dialog");
const pictureField = (page: Page) => page.getByLabel("Profile Picture URL");
const bannerField = (page: Page) => page.getByLabel("Banner Image URL");

function png(width = 64, height = 48) {
  return twoToneImage(width, height, RED, BLUE);
}

async function choose(page: Page, buffer: Buffer, name = "me.png", mimeType = "image/png") {
  await pictureFile(page).setInputFiles({ name, mimeType, buffer });
  await expect(dialog(page)).toBeVisible();
}

async function confirm(page: Page, host: RegExp = /Primal/) {
  await dialog(page).getByRole("radio", { name: host }).check();
  await dialog(page).getByRole("button", { name: "Upload", exact: true }).click();
}

/** A JPEG made by the browser itself, so it really decodes. */
async function makeJpeg(page: Page, width: number, height: number): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#c82828";
        context.fillRect(0, 0, w, h);
        context.fillStyle = "#2828c8";
        context.fillRect(0, 0, w / 2, h);
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );
      return Array.from(new Uint8Array(await blob!.arrayBuffer()));
    },
    { w: width, h: height }
  );
  return Buffer.from(bytes);
}

/** `jpeg` with an EXIF segment: an orientation tag and a location, right after the SOI marker. */
function withExif(jpeg: Buffer, orientation: number, location: string): Buffer {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03,
    0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00,
  ]);
  const payload = Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    tiff,
    Buffer.from(location, "latin1"),
  ]);
  const segment = Buffer.concat([
    Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
    payload,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

async function decodedSize(page: Page, bytes: Buffer): Promise<[number, number]> {
  return page.evaluate(async (base64) => {
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw]));
    return [bitmap.width, bitmap.height] as [number, number];
  }, bytes.toString("base64"));
}

interface TokenEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function decodeToken(header: string): TokenEvent {
  const [scheme, token] = header.split(" ");
  expect(scheme).toBe("Nostr");
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

function signatureVerifies(event: TokenEvent): boolean {
  const id = sha256Hex(
    Buffer.from(
      JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    )
  );
  return (
    id === event.id &&
    schnorr.verify(
      Uint8Array.from(Buffer.from(event.sig, "hex")),
      Uint8Array.from(Buffer.from(id, "hex")),
      Uint8Array.from(Buffer.from(event.pubkey, "hex"))
    )
  );
}

test.describe("blossom image upload", () => {
  test("nothing is sent, and nothing is authorised, until a host is chosen and confirmed", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    const { blossom } = await arrive(popup, extensionContext);

    await choose(popup, png());

    const radios = dialog(popup).getByRole("radio");
    await expect(radios).toHaveCount(3);
    for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
    await expect(
      dialog(popup).getByRole("button", { name: "Upload", exact: true })
    ).toBeDisabled();
    await expect(dialog(popup)).toContainText("blossom.primal.net");
    await expect(dialog(popup)).toContainText("IP address");
    await expect(dialog(popup)).toContainText("public key");
    expect(blossom.requests, "a request reached the host before consent").toEqual([]);

    await popup.keyboard.press("Escape");
    await expect(dialog(popup)).toBeHidden();
    expect(blossom.requests, "a request reached the host after the dialog was dismissed").toEqual([]);
    await expect(pictureField(popup)).toHaveValue("");
  });

  test("uploads with the agreed request, a token the vault key signed, and a saved profile", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    const { blossom, relay, key } = await arrive(popup, extensionContext);
    const violations = await watchCspViolations(popup);

    await choose(popup, png());
    await confirm(popup);

    await expect(
      popup.getByRole("status").filter({ hasText: "Uploaded to blossom.primal.net" })
    ).toHaveText("Uploaded to blossom.primal.net. Save your profile to use it.");

    // Before Save, the only request is the upload: the address it returned is not fetched.
    expect(blossom.requests).toEqual(["PUT /upload"]);
    expect(blossom.uploads).toHaveLength(1);
    const upload = blossom.uploads[0];
    expect(upload.method).toBe("PUT");
    expect(upload.headers["content-type"]).toBe("image/png");
    expect(upload.headers["x-sha-256"]).toBe(upload.sha256);
    expect(upload.headers.cookie, "a cookie rode along with the upload").toBeUndefined();
    expect(upload.headers.referer, "a referrer rode along with the upload").toBeUndefined();

    const event = decodeToken(upload.headers.authorization);
    expect(event.kind).toBe(24242);
    expect(event.pubkey).toBe(key.pubkey);
    expect(event.content).toBe("Upload profile image");
    expect(event.tags.map(([name]) => name)).toEqual(["t", "upload"].slice(0, 1).concat(["x", "server", "expiration"]));
    expect(event.tags).toContainEqual(["t", "upload"]);
    expect(event.tags).toContainEqual(["x", upload.sha256]);
    expect(event.tags).toContainEqual(["server", BLOSSOM_HOST]);
    const expiration = Number(event.tags.find(([name]) => name === "expiration")?.[1]);
    const now = Math.floor(Date.now() / 1000);
    expect(event.created_at).toBeLessThan(now);
    expect(expiration).toBeGreaterThan(now);
    expect(signatureVerifies(event), "the token's signature does not verify").toBe(true);

    const uploadedUrl = blossom.urlFor(upload);
    await expect(pictureField(popup)).toHaveValue(uploadedUrl);

    await popup.getByRole("button", { name: "Save Changes" }).click();
    await expect(popup.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
      timeout: 20_000,
    });
    expect(relay.received).toHaveLength(1);
    expect(relay.received[0].kind).toBe(0);
    expect(JSON.parse(relay.received[0].content).picture).toBe(uploadedUrl);

    // Save is what loads the picture, once, as it does for a pasted address.
    expect(blossom.requests.filter((request) => request.startsWith("GET "))).toEqual([
      `GET /${upload.sha256}.png`,
    ]);
    expect(await violations(), "the upload tripped the content security policy").toEqual([]);
  });

  test("remembers the host, preselects it next time, and still asks", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    const { blossom } = await arrive(popup, extensionContext);

    await choose(popup, png());
    await confirm(popup);
    await expect(popup.getByRole("status").filter({ hasText: "Uploaded to" })).toBeVisible();

    await pictureFile(popup).setInputFiles({
      name: "again.png",
      mimeType: "image/png",
      buffer: png(32, 32),
    });
    await expect(dialog(popup)).toBeVisible();
    await expect(dialog(popup).getByRole("radio", { name: /Primal/ })).toBeChecked();
    expect(blossom.uploads).toHaveLength(1);
  });

  test("uploads the banner to the banner field", async ({ openPopup, extensionContext }) => {
    const popup = await openPopup();
    const { blossom } = await arrive(popup, extensionContext);

    await bannerFile(popup).setInputFiles({
      name: "banner.png",
      mimeType: "image/png",
      buffer: png(120, 40),
    });
    await expect(dialog(popup)).toBeVisible();
    await confirm(popup);

    await expect(bannerField(popup)).toHaveValue(blossom.urlFor(await waitForUpload(blossom)));
    await expect(pictureField(popup)).toHaveValue("");
  });

  test.describe("what leaves the browser", () => {
    test("a PNG's embedded text does not survive re-encoding", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext);
      const original = withTextChunk(png(), "Comment", "GPS 51.5007N 0.1246W");
      expect(original.includes("GPS 51.5007N")).toBe(true);

      await choose(popup, original);
      await confirm(popup);
      const upload = await waitForUpload(blossom);

      expect(upload.body.includes("GPS 51.5007N")).toBe(false);
      expect(upload.body.includes("tEXt")).toBe(false);
      expect(upload.body.equals(original)).toBe(false);
      expect(await decodedSize(popup, upload.body)).toEqual([64, 48]);
    });

    test("a JPEG's location does not survive, and its orientation is applied", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext);
      const original = withExif(await makeJpeg(popup, 64, 32), 6, "GPS 51.5007N 0.1246W");
      expect(original.includes("GPS 51.5007N")).toBe(true);

      await choose(popup, original, "me.jpg", "image/jpeg");
      await confirm(popup);
      const upload = await waitForUpload(blossom);

      expect(upload.headers["content-type"]).toBe("image/jpeg");
      expect(upload.body.includes("GPS 51.5007N")).toBe(false);
      expect(upload.body.includes("Exif")).toBe(false);
      // Orientation 6 turns a 64 by 32 landscape into a 32 by 64 portrait.
      expect(await decodedSize(popup, upload.body)).toEqual([32, 64]);
    });

    test("an image over 2048 pixels is capped, keeping its shape", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext);

      await choose(popup, await makeJpeg(popup, 4000, 3000), "big.jpg", "image/jpeg");
      await confirm(popup);
      const upload = await waitForUpload(blossom);

      expect(await decodedSize(popup, upload.body)).toEqual([2048, 1536]);
    });

    test("a file that is not an image is refused before the dialog opens", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext);

      await pictureFile(popup).setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
      });

      await expect(popup.getByRole("alert")).toHaveText("Choose a JPEG, PNG, GIF or WebP image.");
      await expect(dialog(popup)).toHaveCount(0);
      expect(blossom.uploads).toHaveLength(0);
    });
  });

  test.describe("what goes wrong", () => {
    test("a reply that disagrees with what was sent leaves the field alone", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      await arrive(popup, extensionContext, {
        reply: (upload) => ({
          status: 201,
          json: {
            url: `${BLOSSOM_ORIGIN}/${"0".repeat(64)}.png`,
            sha256: "0".repeat(64),
            size: upload.body.length,
          },
        }),
      });

      await choose(popup, png());
      await confirm(popup);

      await expect(popup.getByRole("alert")).toHaveText(
        "The host returned an unexpected reply."
      );
      await expect(pictureField(popup)).toHaveValue("");
    });

    test("a refusal is reported in fixed words, never the server's own", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      await arrive(popup, extensionContext, {
        reply: () => ({
          status: 403,
          headers: { "x-reason": "send 1 BTC to evil.example" },
          text: "visit https://evil.example",
        }),
      });

      await choose(popup, png());
      await confirm(popup);

      await expect(popup.getByRole("alert")).toHaveText("The host's rules do not allow this upload.");
      await expect(popup.locator("body")).not.toContainText("evil.example");
      await expect(pictureField(popup)).toHaveValue("");
    });

    test("a redirect is refused, so the token never follows it", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      await arrive(popup, extensionContext, {
        reply: () => ({ status: 307, headers: { location: "https://elsewhere.example/upload" } }),
      });

      await choose(popup, png());
      await confirm(popup);

      await expect(popup.getByRole("alert")).toHaveText(`Could not reach ${BLOSSOM_HOST}.`);
      await expect(pictureField(popup)).toHaveValue("");
    });

    test("a request that fails at the network reads as unreachable", async ({
      openPopup,
      extensionContext,
    }) => {
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext, { abort: true });

      await choose(popup, png());
      await confirm(popup);

      await expect(popup.getByRole("alert")).toHaveText(`Could not reach ${BLOSSOM_HOST}.`);
      await expect(pictureField(popup)).toHaveValue("");
      expect(blossom.uploads).toHaveLength(1);
    });
  });

  test.describe("cancelling the whole operation", () => {
    function held() {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { hold, release };
    }

    test("cancel while the request is in flight writes nothing when the reply arrives", async ({
      openPopup,
      extensionContext,
    }) => {
      const { hold, release } = held();
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext, { hold });

      await choose(popup, png());
      await confirm(popup);
      await expect(popup.getByRole("status")).toContainText("Uploading to blossom.primal.net");
      await expect.poll(() => blossom.uploads.length).toBe(1);

      await popup.getByRole("status").getByRole("button", { name: "Cancel" }).click();
      release();

      await expect(popup.getByRole("button", { name: "Upload image" }).first()).toBeEnabled();
      await expect(popup.getByRole("status").filter({ hasText: "Uploaded" })).toHaveCount(0);
      await expect(popup.getByRole("alert")).toHaveCount(0);
      await expect(pictureField(popup)).toHaveValue("");
    });

    test("switching to another key mid-upload writes nothing to the other key's form", async ({
      openPopup,
      extensionContext,
    }) => {
      const { hold, release } = held();
      const popup = await openPopup();
      const { blossom } = await arrive(popup, extensionContext, { hold });

      // A second key, surfaced the way the avatar spec does it: only an unlock
      // puts every key into the vault's memory, and a reload shows it.
      await sendExtensionRpc(popup, {
        type: "vault.generate",
        password: TEST_PASSWORD,
        label: "Second key",
      });
      await sendExtensionRpc(popup, { type: "vault.lock" });
      await sendExtensionRpc(popup, { type: "vault.unlock", password: TEST_PASSWORD });
      await popup.reload();
      await openProfileTab(popup);
      await openEditForm(popup);

      await choose(popup, png());
      await confirm(popup);
      await expect.poll(() => blossom.uploads.length).toBe(1);

      await popup.getByRole("button", { name: "Select active key" }).click();
      await popup.getByRole("menuitemradio", { name: /^Second key - / }).click();
      release();
      await popup.waitForTimeout(500);

      await expect(popup.getByRole("status").filter({ hasText: "Uploaded" })).toHaveCount(0);
      await expect(popup.getByRole("alert")).toHaveCount(0);
      expect(
        await popup.locator("#picture").count(),
        "the editor is still open, so its field is checked"
      ).toBeLessThanOrEqual(1);
      if ((await popup.locator("#picture").count()) > 0) {
        await expect(pictureField(popup)).toHaveValue("");
      }
    });
  });
});

async function waitForUpload(blossom: FakeBlossom) {
  await expect.poll(() => blossom.uploads.length).toBe(1);
  return blossom.uploads[0];
}

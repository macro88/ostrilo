import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import fsSync from "node:fs";
import { deflateSync } from "node:zlib";
import { ensureDevCertificate } from "../../tests/e2e/fixtures/make-dev-cert.ts";

const cwd = process.cwd();
const extensionPath = path.join(cwd, ".output", "chrome-mv3");

/**
 * One run captures one theme:
 *
 *   node docs/design-review/capture-screenshots.mjs
 *   OSTRILO_DESIGN_REVIEW_THEME=dark node docs/design-review/capture-screenshots.mjs
 *
 * DESIGN_RULES §12 requires every surface to hold up in light AND dark, and §3
 * is explicit that Deep Ink is not an inversion — it reassigns roles, so it has
 * to be photographed rather than inferred from the light capture.
 *
 * Two invocations rather than one two-pass run: this script drives onboarding
 * from an empty vault, and that only happens once per browser profile.
 */
const theme =
  process.env.OSTRILO_DESIGN_REVIEW_THEME === "dark" ? "dark" : "light";
const screenshotsRoot = path.join(cwd, "docs", "design-review", "screenshots");
const outDir =
  theme === "dark" ? path.join(screenshotsRoot, "dark") : screenshotsRoot;
const userDataDir = path.join(
  "/private/tmp",
  `ostrilo-design-review-${theme}-${Date.now()}`
);

await fs.mkdir(outDir, { recursive: true });
console.log(`Capturing ${theme} theme into ${outDir}`);

async function launchContext(profileDir = userDataDir) {
  const base = {
    headless: true,
    viewport: { width: 400, height: 600 },
    // The theme setting defaults to "system" and every surface mounts
    // useTheme, so driving prefers-color-scheme exercises the real
    // resolveEffectiveTheme path instead of forcing the .dark class on.
    colorScheme: theme,
    // The fixture server below uses a throwaway self-signed certificate,
    // because the content script matches https:// only. This browser instance
    // is a review artifact and trusts nothing else.
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--ignore-certificate-errors",
      // The populated phase seeds activity and policies from origins that
      // read like real sites. Both names resolve to the fixture server; the
      // certificate mismatch is covered by the flag above.
      "--host-resolver-rules=MAP nostrich.org 127.0.0.1, MAP snort.social 127.0.0.1",
    ],
  };

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...base,
      channel: "chromium",
    });
  } catch (error) {
    console.warn("Falling back to bundled Chromium:", error.message);
    return await chromium.launchPersistentContext(profileDir, base);
  }
}

function startServer() {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>Ostrilo test dapp</title></head><body><h1>Ostrilo test dapp</h1><button id="sign" type="button">Sign</button></body></html>';
  // TLS, not plain HTTP: the NIP-07 content script matches `https://*/*`
  // only (hardened in aa5c706), so an http:// page never gets window.nostr
  // and the approval captures silently fall out of the run.
  const { cert, key } = ensureDevCertificate();
  const server = https.createServer(
    { cert: fsSync.readFileSync(cert), key: fsSync.readFileSync(key) },
    (req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    }
  );

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `https://localhost:${address.port}` });
    });
  });
}

async function waitForExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const match = worker.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
  if (!match) throw new Error(`Could not parse extension id from ${worker.url()}`);
  return match[1];
}

async function screenshot(page, name, options = {}) {
  await page.waitForTimeout(options.delay ?? 250);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  console.log(file);
}

/** Scrolls every scrollable region to its end, for what sits under the fold. */
async function scrollToEnd(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== "visible") {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
}

async function safeClick(locator, timeout = 5000) {
  await locator.waitFor({ state: "visible", timeout });
  await locator.click();
}

async function captureTabs(page, tabs) {
  async function captureNext(index) {
    if (index >= tabs.length) {
      return;
    }

    const [name, label] = tabs[index];
    await safeClick(page.getByRole("tab", { name: label }));
    await screenshot(page, name);
    await captureNext(index + 1);
  }

  await captureNext(0);
}

// aislop-ignore-next-line security/hardcoded-secret -- throwaway passphrase for a local screenshot vault that is created and discarded by this script. It unlocks nothing that exists outside this run.
const PASSWORD = "CorrectHorseBatteryStaple!2026";
// aislop-ignore-next-line security/hardcoded-secret -- throwaway replacement password for the same discarded screenshot vault as PASSWORD above. It unlocks nothing that exists outside this run.
const CHANGED_PASSWORD = "Lichen-Harbour-Quill-2026";

// What a profile host's CDN address looks like once it carries a size, a
// signature and a cache key. Long enough to widen anything that does not wrap.
const LONG_PICTURE_URL =
  "https://images.jimbo-the-signer.example/avatars/2026/10/jimbo-jesus-jones-profile-picture-original-upload-with-a-very-long-descriptive-filename.png?width=512&height=512&fit=cover&signature=3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

/**
 * A 96x96 PNG as a `data:` URL, for the header's local picture copy.
 *
 * Built here rather than read from disk so the runner stays one file. The
 * image is a flat ink-and-violet mark, not a photograph: what the review
 * judges is the header's fixed box and the seal clip around it. With
 * `transparent` the background has no alpha, as a logo or a sticker PNG does,
 * so the review sees what shows through the seal behind it.
 */
function pictureCopyDataUrl({ transparent = false } = {}) {
  const size = 96;
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    return Buffer.concat([u32(data.length), body, u32(crc(body))]);
  };

  const channels = transparent ? 4 : 3;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * channels);
    for (let x = 0; x < size; x += 1) {
      const inDisc = (x - 48) ** 2 + (y - 40) ** 2 < 18 ** 2;
      const inBody = y > 62 && (x - 48) ** 2 + (y - 96) ** 2 < 36 ** 2;
      const mark = inDisc || inBody;
      const [r, g, b] = transparent
        ? [93, 63, 211]
        : mark
          ? [244, 240, 255]
          : [93, 63, 211];
      row[1 + x * channels] = r;
      row[2 + x * channels] = g;
      row[3 + x * channels] = b;
      if (transparent) row[4 + x * channels] = mark ? 255 : 0;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = transparent ? 6 : 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Privileged RPC from an extension page; throws on an error envelope. */
async function rpc(page, message) {
  const response = await page.evaluate(
    // aislop-ignore-next-line eslint/no-undef -- runs in the page's browser context via page.evaluate, not in Node; `chrome` is defined there.
    (m) => chrome.runtime.sendMessage(m),
    message
  );
  if (!response?.ok) {
    const err = response?.error;
    throw new Error(
      `${message.type} failed: ${err?.data?.errorCode ?? err?.message ?? "unknown"}${
        err?.data?.details ? ` (${err.data.details})` : ""
      }`
    );
  }
  return response.data;
}

/**
 * One populated-state capture. A failure here is logged and skipped so the
 * rest of the run still lands; the missing file is the signal.
 */
async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.warn(`populated step "${name}" failed:`, error.message);
  }
}

async function signFromPage(page, event) {
  return page.evaluate(async (ev) => {
    try {
      await window.nostr.signEvent(ev);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, event);
}

/** Fires a request that will prompt, without waiting for the answer. */
async function beginSignFromPage(page, event) {
  await page.evaluate((ev) => {
    window.__ostriloPending = (window.__ostriloPending || []).concat(
      window.nostr.signEvent(ev).catch((e) => String(e?.message || e))
    );
  }, event);
}

async function beginGetPublicKey(page) {
  await page.evaluate(() => {
    window.__ostriloPending = (window.__ostriloPending || []).concat(
      window.nostr.getPublicKey().catch((e) => String(e?.message || e))
    );
  });
}

const HEX64 = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

async function getPendingCount(page) {
  const countResult = await page.evaluate(() =>
    // aislop-ignore-next-line eslint/no-undef -- runs in the page's browser context via page.evaluate, not in Node; `chrome` is defined there.
    chrome.runtime.sendMessage({ type: "approval.count" })
  );
  return countResult?.data?.count ?? 0;
}

async function waitForPendingCount(page, deadline) {
  const count = await getPendingCount(page);
  if (count > 0 || Date.now() >= deadline) {
    return count;
  }

  await page.waitForTimeout(250);
  return waitForPendingCount(page, deadline);
}

const context = await launchContext();
const serverInfo = await startServer();

try {
  const extensionId = await waitForExtensionId(context);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const approvalUrl = `chrome-extension://${extensionId}/approval.html`;

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 600 });
  await popup.goto(popupUrl);
  await popup.getByText("Welcome to Ostrilo").waitFor({ timeout: 15000 });
  await screenshot(popup, "01-onboarding-welcome");

  // Tapping a welcome row proceeds; there is no select-then-Continue step any
  // more, so there is no "create choice" state left to photograph.
  await safeClick(popup.getByRole("button", { name: /Create New Key/i }));
  await popup.getByText("Create Your Nostr Key").waitFor({ timeout: 10000 });
  await screenshot(popup, "03-onboarding-create-key");

  await popup.locator("#keyName").fill("Design Review Key");
  await popup.locator("#password").fill("CorrectHorseBatteryStaple!2026");
  await popup.locator("#confirm-password").fill("CorrectHorseBatteryStaple!2026");
  await safeClick(popup.getByRole("button", { name: /Create Key/i }), 10000);
  await popup.getByText("Backup Your Key").waitFor({ timeout: 20000 });
  await screenshot(popup, "04-onboarding-backup");

  // Finish is gated on backup verification, not on the acknowledgement
  // checkbox, so the runner has to answer the suffix challenge the way
  // tests/e2e/onboarding-create.spec.ts does. The key is re-masked before any
  // screenshot is taken: no capture commits an nsec to the repository.
  await safeClick(
    popup.getByRole("button", { name: "Reveal Private Key" }),
    10000
  );
  const keyField = popup.getByLabel("Private Key (nsec format)");
  await keyField.waitFor({ state: "visible", timeout: 10000 });
  await safeClick(popup.getByRole("button", { name: "Show private key" }));
  const nsec = await keyField.inputValue();
  await safeClick(popup.getByRole("button", { name: "Hide private key" }));

  const verification = popup.getByLabel(/Last \d+ characters of your nsec/);
  await verification.waitFor({ state: "visible", timeout: 10000 });
  await screenshot(popup, "04b-onboarding-backup-revealed");

  // Read the length off the input rather than restating
  // VERIFICATION_SUFFIX_LENGTH, which this script cannot import.
  const suffixLength =
    Number(await verification.getAttribute("maxlength")) || 8;
  await verification.fill(nsec.slice(-suffixLength));
  await safeClick(popup.getByRole("button", { name: "Check", exact: true }));
  await popup.getByText("Backup verified").waitFor({ timeout: 10000 });

  await popup.locator("#backupConfirm").check();
  await safeClick(popup.getByRole("button", { name: /Finish/i }), 10000);
  await popup.getByRole("heading", { name: "Design Review Key" }).waitFor({
    timeout: 20000,
  });
  await screenshot(popup, "05-popup-home");

  const sidepanel = await context.newPage();
  await sidepanel.setViewportSize({ width: 520, height: 700 });
  await sidepanel.goto(sidepanelUrl);
  await sidepanel.getByRole("heading", { name: "Design Review Key" }).waitFor({
    timeout: 15000,
  });
  await screenshot(sidepanel, "06-sidepanel-home");

  await safeClick(popup.getByRole("button", { name: /Profile/i }));
  await popup.getByText("Profile Settings").waitFor({ timeout: 10000 });
  // The profile fetch renders skeletons and a disabled Edit Profile until the
  // relay answers or the deadline passes. Photograph the resting state, not
  // the first 250ms of the fetch.
  await popup
    .locator('button:has-text("Edit Profile"):not([disabled])')
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await screenshot(popup, "07-popup-profile");
  const editProfile = popup.getByRole("button", { name: /Edit Profile/i });
  if (await editProfile.isVisible().catch(() => false)) {
    await editProfile.click();
    await popup.getByText("Edit Profile").waitFor({ timeout: 10000 });
    await screenshot(popup, "08-popup-profile-edit");
    await safeClick(popup.getByRole("button", { name: /Cancel/i }));
  }

  await safeClick(popup.getByRole("button", { name: /Activity/i }));
  await popup.getByText("Recent Activity").waitFor({ timeout: 10000 });
  await screenshot(popup, "09-popup-activity");

  await safeClick(popup.getByRole("button", { name: /Settings/i }));
  await popup
    .getByText("Quick controls for this signer window.")
    .waitFor({ timeout: 10000 });
  await screenshot(popup, "10-popup-quick-settings");

  const keySelector = popup.getByLabel("Select active key");
  if (await keySelector.isVisible().catch(() => false)) {
    await keySelector.click();
    await safeClick(popup.getByText("Add Key").last());
    await popup.getByText("Add New Key").waitFor({ timeout: 10000 });
    await screenshot(popup, "11-add-key-dialog");
    await popup.keyboard.press("Escape");
  }

  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 900 });
  await options.goto(optionsUrl);
  await options.getByText("Ostrilo Settings").waitFor({ timeout: 15000 });
  const tabs = [
    ["12-options-general", "General"],
    ["13-options-keys", "Keys & Identities"],
    ["14-options-security", "Security"],
    ["15-options-permissions", "Permissions"],
    ["16-options-activity-log", "Activity Log"],
    ["17-options-relays", "Relays"],
    ["18-options-advanced", "Advanced"],
  ];
  await captureTabs(options, tabs);

  const approvalEmpty = await context.newPage();
  await approvalEmpty.setViewportSize({ width: 400, height: 600 });
  await approvalEmpty.goto(approvalUrl);
  await approvalEmpty
    .getByText(/No Pending Requests|Pending Approvals|Error/)
    .waitFor({ timeout: 15000 });
  await screenshot(approvalEmpty, "19-approval-empty");

  // No policy is pre-seeded for the origin. Kind 1 is a protected kind, so it
  // prompts regardless, and a site the extension has never seen is the state
  // a first signing request actually arrives in - it is what puts the red
  // FIRST VISIT chip on the origin block (DESIGN_RULES §8). Seeding a `low`
  // record used to photograph the rarer "answered before, never trusted" case.
  const origin = serverInfo.origin;

  const dapp = await context.newPage();
  await dapp.goto(`${origin}/test-page.html`);
  await dapp.waitForFunction(() => typeof window.nostr !== "undefined", null, {
    timeout: 10000,
  });
  await dapp.evaluate((event) => {
    window.__ostriloDesignReviewSign = window.nostr
      .signEvent(event)
      .catch((error) => String(error?.message || error));
  }, {
    kind: 1,
    content: "Design review screenshot approval request",
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });

  const pendingCount = await waitForPendingCount(popup, Date.now() + 10000);
  console.log("pending approval count", pendingCount);

  if (pendingCount > 0) {
    const approvalQueue = await context.newPage();
    await approvalQueue.setViewportSize({ width: 400, height: 600 });
    await approvalQueue.goto(approvalUrl);
    // A lone request opens on its detail: one request is one decision, so the
    // window as it opens IS the decision screen. Photographed past the approve
    // cooldown for the same reason 21 is. The queue with a single request is
    // one back-tap away and is captured next, so the review still sees it.
    await approvalQueue
      .getByRole("heading", { name: /request/i })
      .waitFor({ timeout: 15000 });
    await approvalQueue
      .getByRole("button", { name: /Approve & sign/i })
      .waitFor({ state: "visible", timeout: 10000 });
    await screenshot(approvalQueue, "20-approval-queue", { delay: 900 });
    await safeClick(
      approvalQueue.getByRole("button", { name: "Back to approval queue" })
    );
    await approvalQueue.getByText(/Approval Inbox|Pending Approvals/).waitFor({
      timeout: 10000,
    });
    await screenshot(approvalQueue, "20b-approval-queue-via-back");
    const firstRequest = approvalQueue
      .getByRole("button")
      .filter({ hasText: /Kind 1|Short Text Note|Design review/ })
      .last();
    if (await firstRequest.isVisible().catch(() => false)) {
      await firstRequest.click();
    } else {
      await approvalQueue.getByText(/Short Text Note|Kind 1/).click();
    }
    await approvalQueue
      .getByRole("heading", { name: /request/i })
      .waitFor({ timeout: 10000 });

    // Past APPROVE_COOLDOWN_MS (500ms). Approve is deliberately disabled while
    // the pane binds to a new request, so the default 250ms delay photographed
    // the product's most important button in a state no user acts on.
    await approvalQueue
      .getByRole("button", { name: /Approve & sign/i })
      .waitFor({ state: "visible", timeout: 10000 });
    await screenshot(approvalQueue, "21-approval-detail", { delay: 900 });

    // The content panel now sits above the fold at 400x600, so this second
    // shot photographs the other half of the payload: the raw event envelope
    // behind "View raw JSON", which is what a user cross-checking against the
    // dapp actually reads. A fullPage capture stops at the viewport, so the
    // toggle is scrolled into view before it is opened.
    const rawJsonToggle = approvalQueue.getByRole("button", {
      name: /View raw JSON/i,
    });
    if (await rawJsonToggle.isVisible().catch(() => false)) {
      await rawJsonToggle.scrollIntoViewIfNeeded();
      await rawJsonToggle.click();
      const rawJson = approvalQueue.getByTestId("approval-raw-json");
      await rawJson.waitFor({ state: "visible", timeout: 5000 });
      await rawJson.scrollIntoViewIfNeeded();
      await screenshot(approvalQueue, "21b-approval-payload");
    }
  }

  await safeClick(popup.getByRole("button", { name: /Lock extension/i }));
  await popup.getByText(/Ostrilo is Locked/i).waitFor({ timeout: 10000 });
  await screenshot(popup, "22-lock-screen");

  // ───────────────────────── Populated state ─────────────────────────
  // Everything above photographs a brand-new vault with nothing in it. Real
  // use has a long key name, several keys, signed and denied activity, site
  // policies at every trust level, several relays and a profile. Layout bugs
  // (cards shrinking, rows clipping, names truncating) only show up here.
  const port = new URL(serverInfo.origin).port;
  const nostrich = `https://nostrich.org:${port}`;
  const snort = `https://snort.social:${port}`;
  const KEY_NAME = "Jimbo Jesus Jones";

  await step("unlock", async () => {
    await popup.locator('input[type="password"]').first().fill(PASSWORD);
    await popup.keyboard.press("Enter");
    await popup
      .getByRole("heading", { level: 2, name: "Design Review Key" })
      .waitFor({ timeout: 15000 });
  });

  await step("seed keys", async () => {
    const list = await rpc(popup, { type: "keys.list" });
    // `keys.list` returns a bare array; `list.keys` would be Array.prototype.keys.
    const keys = Array.isArray(list) ? list : list?.keys ?? [];
    const first = keys.find((k) => k.label === "Design Review Key") ?? keys[0];
    await rpc(popup, { type: "vault.renameKey", id: first.id, label: KEY_NAME });
    await rpc(popup, { type: "vault.generate", password: PASSWORD, label: "Work" });
    await rpc(popup, { type: "vault.select", id: first.id });
  });

  await step("seed profile", async () => {
    // Publish against a dead relay so nothing leaves the machine; the
    // optimistic cache write is what the profile view reads.
    await rpc(popup, {
      type: "settings.update",
      patch: { relays: ["wss://localhost:1"] },
    });
    await rpc(popup, {
      type: "profile.update",
      params: {
        metadata: {
          name: "jimbo",
          display_name: KEY_NAME,
          about: "Signs things locally. Never snoops.",
          website: "https://jimbo.example",
          picture: LONG_PICTURE_URL,
        },
      },
    }).catch((error) => console.warn("profile.update:", error.message));
    await rpc(popup, {
      type: "settings.update",
      patch: {
        relays: ["wss://relay.primal.net", "wss://relay.damus.io", "wss://nos.lol"],
      },
    });
  });

  await step("seed picture copy", async () => {
    // The header reads only a stored local copy, so a populated vault needs one.
    // Stored directly rather than through a Profile save, which would load the
    // picture URL above: that host does not exist, and the runner's relays and
    // pages must not reach the network.
    const list = await rpc(popup, { type: "keys.list" });
    const jimbo = list.find((k) => k.label === KEY_NAME);
    await rpc(popup, {
      type: "avatar.save",
      pubkey: jimbo.pubkey,
      sourceUrl: LONG_PICTURE_URL,
      dataUrl: pictureCopyDataUrl(),
    });
    // The second key's picture has a transparent background, which is what a
    // logo PNG is. The header must still read as one seal, not as a square.
    const work = list.find((k) => k.label === "Work");
    await rpc(popup, {
      type: "avatar.save",
      pubkey: work.pubkey,
      sourceUrl: "https://work.example/logo.png",
      dataUrl: pictureCopyDataUrl({ transparent: true }),
    });
  });

  await step("seed policies", async () => {
    await rpc(popup, {
      type: "policy.setOrigin",
      origin: nostrich,
      patch: { trustLevel: "high", identityDisclosure: "allow", name: "Nostrich" },
      password: PASSWORD,
    });
    // A grant is for the key selected when it is made, so a site that may read
    // two identities needs the grant made once under each. Without the second,
    // the Permissions capture would only ever show a one-grant row.
    const list = await rpc(popup, { type: "keys.list" });
    const all = Array.isArray(list) ? list : list?.keys ?? [];
    const jimbo = all.find((k) => k.label === KEY_NAME);
    const work = all.find((k) => k.label === "Work");
    await rpc(popup, { type: "vault.select", id: work.id });
    await rpc(popup, {
      type: "policy.setOrigin",
      origin: nostrich,
      patch: { identityDisclosure: "allow" },
      password: PASSWORD,
    });
    await rpc(popup, { type: "vault.select", id: jimbo.id });
    await rpc(popup, {
      type: "policy.setKindRule",
      origin: nostrich,
      kind: 7,
      mode: "allow",
      password: PASSWORD,
    });
    await rpc(popup, {
      type: "policy.setOrigin",
      origin: snort,
      patch: { trustLevel: "medium" },
    });
    await rpc(popup, {
      type: "policy.setOrigin",
      origin: "https://primal.net",
      patch: { trustLevel: "low", identityDisclosure: "deny" },
    });
  });

  const nostrichPage = await context.newPage();
  const snortPage = await context.newPage();
  await step("seed activity", async () => {
    await nostrichPage.goto(`${nostrich}/test-page.html`);
    await nostrichPage.waitForFunction(() => typeof window.nostr !== "undefined", null, { timeout: 10000 });
    await nostrichPage.evaluate(() => window.nostr.getPublicKey());
    const reaction = (content) => ({
      kind: 7,
      content,
      tags: [["e", HEX64], ["p", HEX64]],
      created_at: Math.floor(Date.now() / 1000),
    });
    console.log("nostrich sign 7", JSON.stringify(await signFromPage(nostrichPage, reaction("+"))));
    console.log("nostrich sign 7", JSON.stringify(await signFromPage(nostrichPage, reaction("🤙"))));
    // One refusal, so the log shows a red mark.
    await beginSignFromPage(nostrichPage, {
      kind: 1,
      content: "A note the user decides not to sign",
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    });
    await waitForPendingCount(popup, Date.now() + 8000);
    const pending = await rpc(popup, { type: "approval.getAll" });
    const toDeny = (pending?.requests ?? [])[0];
    if (toDeny) {
      await rpc(popup, { type: "approval.resolve", requestId: toDeny.id, action: "deny" });
    }

    await snortPage.goto(`${snort}/test-page.html`);
    await snortPage.waitForFunction(() => typeof window.nostr !== "undefined", null, { timeout: 10000 });
    console.log("snort sign 7", JSON.stringify(await signFromPage(snortPage, reaction("+"))));
  });

  await step("queue pending requests", async () => {
    // Left pending for the queue captures: two sites, three requests.
    await beginSignFromPage(nostrichPage, {
      kind: 1,
      content: "GM nostr. Testing my new signer, it keeps the keys in the browser and asks before anything is signed.",
      tags: [["t", "introductions"]],
      created_at: Math.floor(Date.now() / 1000),
    });
    await beginGetPublicKey(snortPage);
    await beginSignFromPage(snortPage, {
      kind: 1,
      content: "Reply from a site with medium trust",
      tags: [["e", HEX64, "", "reply"], ["p", HEX64]],
      created_at: Math.floor(Date.now() / 1000),
    });
    await popup.waitForTimeout(800);
  });

  await step("23-popup-home-populated", async () => {
    await popup.reload();
    await popup.getByRole("heading", { level: 2, name: KEY_NAME }).waitFor({ timeout: 15000 });
    await popup.getByText("Signed reaction").first().waitFor({ timeout: 10000 });
    await screenshot(popup, "23-popup-home-populated");
  });

  await step("24-popup-activity-populated", async () => {
    await safeClick(popup.getByRole("button", { name: /Activity/i }));
    await popup.getByText("Recent Activity").waitFor({ timeout: 10000 });
    await popup.getByText(/reaction/i).first().waitFor({ timeout: 10000 });
    await screenshot(popup, "24-popup-activity-populated", { delay: 600 });
  });

  await step("25-popup-profile-populated", async () => {
    await safeClick(popup.getByRole("button", { name: /Profile/i }));
    await popup.getByText("Profile Settings").waitFor({ timeout: 10000 });
    await popup
      .locator('button:has-text("Edit Profile"):not([disabled])')
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await screenshot(popup, "25-popup-profile-populated");
  });

  // The picture row sits under the fold of the 400x600 popup. Scrolled to, it
  // shows the long address wrapping inside the row and the Refresh picture
  // control beside Edit Profile.
  await step("25b-popup-profile-picture-row", async () => {
    await scrollToEnd(popup);
    await screenshot(popup, "25b-popup-profile-picture-row");
  });

  await step("26-popup-settings-populated", async () => {
    await safeClick(popup.getByRole("button", { name: /Settings/i }));
    await popup.getByText("Quick controls for this signer window.").waitFor({ timeout: 10000 });
    await screenshot(popup, "26-popup-settings-populated");
  });

  await step("27-key-selector-open", async () => {
    await safeClick(popup.getByRole("button", { name: /Home/i }));
    await popup.getByRole("heading", { level: 2, name: KEY_NAME }).waitFor({ timeout: 10000 });
    await popup.getByLabel("Select active key").click();
    await popup.getByRole("menuitemradio").first().waitFor({ timeout: 5000 });
    await screenshot(popup, "27-key-selector-open");
    await popup.keyboard.press("Escape");
  });

  await step("28-sidepanel-home-populated", async () => {
    await sidepanel.reload();
    await sidepanel.getByRole("heading", { level: 2, name: KEY_NAME }).waitFor({ timeout: 15000 });
    await sidepanel.getByText("Signed reaction").first().waitFor({ timeout: 10000 });
    await screenshot(sidepanel, "28-sidepanel-home-populated");
  });

  // The selected key above was backed up in onboarding. "Work" was generated
  // afterwards, so its backup is pending and Home asks about it. Selected for
  // the captures and handed back, because every later surface expects the
  // named key.
  await step("23b-popup-home-backup-banner", async () => {
    const list = await rpc(popup, { type: "keys.list" });
    const all = Array.isArray(list) ? list : list?.keys ?? [];
    const jimbo = all.find((k) => k.label === KEY_NAME);
    const work = all.find((k) => k.label === "Work");
    await rpc(popup, { type: "vault.select", id: work.id });
    try {
      await popup.reload();
      await popup.getByRole("heading", { level: 2, name: "Work" }).waitFor({ timeout: 15000 });
      await popup.getByText("This key has no backup").waitFor({ timeout: 10000 });
      await popup.getByText("Signed reaction").first().waitFor({ timeout: 10000 });
      await screenshot(popup, "23b-popup-home-backup-banner");

      // The banner pushes the second activity row below the fold, so the review
      // must see that scrolling reaches it whole and clear of the tab bar.
      await scrollToEnd(popup);
      await screenshot(popup, "23c-popup-home-backup-banner-scrolled");

      await sidepanel.reload();
      await sidepanel.getByText("This key has no backup").waitFor({ timeout: 15000 });
      await sidepanel.getByText("Signed reaction").first().waitFor({ timeout: 10000 });
      await screenshot(sidepanel, "28b-sidepanel-home-backup-banner");
    } finally {
      await rpc(popup, { type: "vault.select", id: jimbo.id });
      await popup.reload();
      await sidepanel.reload();
    }
  });

  await step("options populated", async () => {
    await options.reload();
    await options.getByText("Ostrilo Settings").waitFor({ timeout: 15000 });
    await captureTabs(options, [
      ["29-options-keys-populated", "Keys & Identities"],
      ["30-options-permissions-populated", "Permissions"],
      ["31-options-relays-populated", "Relays"],
    ]);

    // A site's controls (trust level, public-key grant, session grant, rules
    // by kind, remove) open under its row. Photograph one open, or the only
    // capture of those controls would be the collapsed list.
    await safeClick(options.getByRole("tab", { name: "Permissions" }));
    const firstSite = options.locator('[data-testid^="origin-row-"]').first();
    if (await firstSite.isVisible().catch(() => false)) {
      await firstSite.click();
      await screenshot(options, "30b-options-permissions-site-expanded");
    }
  });

  // Back up a key that has none: the re-authentication prompt, then the
  // backup dialog itself. Before the password change below, so PASSWORD works.
  await step("back up dialog", async () => {
    await safeClick(options.getByRole("tab", { name: "Keys & Identities" }));
    await safeClick(options.getByRole("button", { name: "Back up Work" }));
    const reauth = options.getByRole("dialog");
    await reauth.locator("#reauth-password").fill(PASSWORD);
    await screenshot(options, "29b-options-back-up-reauth");
    await safeClick(reauth.getByRole("button", { name: "Confirm" }), 10000);
    const backup = options.getByRole("dialog", { name: /Back up .Work./ });
    await backup.waitFor({ timeout: 20000 });
    await screenshot(options, "29c-options-back-up-dialog");
    await options.keyboard.press("Escape");
    await backup.waitFor({ state: "hidden", timeout: 5000 });
  });

  // The change-password dialog in each state it can show. Order matters: the
  // throttle is shared with unlock, so the throttled capture comes last and
  // the counter is reset afterwards, or the lock-screen capture below would
  // photograph a backoff instead of a wrong password.
  await step("change password dialog", async () => {
    const NEW_PASSWORD = CHANGED_PASSWORD;
    await safeClick(options.getByRole("tab", { name: "Security" }));
    const openDialog = async () => {
      await safeClick(options.getByRole("button", { name: "Change password", exact: true }));
      return options.getByRole("dialog");
    };
    const submitWith = async (dialog, current, next) => {
      await dialog.getByLabel("Current password", { exact: true }).fill(current);
      await dialog.getByLabel("New password", { exact: true }).fill(next);
      await dialog.getByLabel("Confirm new password", { exact: true }).fill(next);
      await dialog.getByRole("button", { name: "Change password", exact: true }).click();
    };

    let dialog = await openDialog();
    await screenshot(options, "35-change-password-empty");

    await submitWith(dialog, "not-the-password", NEW_PASSWORD);
    await dialog.getByRole("alert").waitFor({ timeout: 10000 });
    await screenshot(options, "35b-change-password-error");

    await submitWith(dialog, PASSWORD, NEW_PASSWORD);
    await dialog.getByTestId("change-password-success").waitFor({ timeout: 15000 });
    await screenshot(options, "35c-change-password-success");
    await safeClick(dialog.getByRole("button", { name: "Done" }));

    dialog = await openDialog();
    for (let attempt = 0; attempt < 5; attempt++) {
      await submitWith(dialog, "not-the-password", PASSWORD);
      await dialog.getByRole("alert").waitFor({ timeout: 10000 });
    }
    await dialog.getByText(/Try again in \d+ seconds/).waitFor({ timeout: 10000 });
    await screenshot(options, "35d-change-password-throttled");
    await safeClick(dialog.getByRole("button", { name: "Cancel" }));

    // Wait out the backoff, then clear the counter with a verified password.
    await options.waitForTimeout(6000);
    await rpc(popup, { type: "vault.unlock", password: NEW_PASSWORD });
  });

  await step("approval queue populated", async () => {
    const queue = await context.newPage();
    await queue.setViewportSize({ width: 400, height: 600 });
    await queue.goto(approvalUrl);
    await queue.getByText(/Approval Inbox|Pending Approvals/).waitFor({ timeout: 15000 });
    await screenshot(queue, "32-approval-queue-populated", { delay: 600 });
    // Expand the second site if collapsed, then open its identity request.
    const snortGroup = queue.locator('[data-testid="approval-origin-group"][data-origin*="snort"]');
    if (await snortGroup.isVisible().catch(() => false)) {
      const toggle = snortGroup.getByRole("button").first();
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      const item = snortGroup.getByText(/Identity disclosure/i).first();
      await item.click();
      await queue
        .getByRole("button", { name: /Deny/i })
        .first()
        .waitFor({ timeout: 10000 });
      await screenshot(queue, "33-approval-detail-disclosure", { delay: 900 });
    }
  });

  // A site with a remembered allow rule gets 60 silent signatures a minute. The
  // next request opens the approval window like an unremembered one, with a
  // line saying why. Photographed at the approval window's narrow width, the
  // one the earlier review did not reach. The queue is emptied first so the
  // request opens alone, on its detail.
  await step("39-approval-over-budget", async () => {
    const queued = await rpc(popup, { type: "approval.getAll" });
    for (const request of queued?.requests ?? []) {
      await rpc(popup, { type: "approval.resolve", requestId: request.id, action: "deny" });
    }
    const stoppedAt = await nostrichPage.evaluate(async () => {
      for (let i = 0; i < 80; i += 1) {
        const attempt = window.nostr
          .signEvent({
            kind: 7,
            content: "+",
            tags: [],
            created_at: Math.floor(Date.now() / 1000) + i,
          })
          .then(
            () => "signed",
            (error) => String(error?.message || error)
          );
        const outcome = await Promise.race([
          attempt,
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 1500)),
        ]);
        if (outcome === "waiting") {
          window.__ostriloPending = (window.__ostriloPending || []).concat(attempt);
          return i;
        }
      }
      return -1;
    });
    console.log("auto-sign budget reached after", stoppedAt, "requests");
    if (stoppedAt < 0) throw new Error("the auto-sign budget never asked");
    await waitForPendingCount(popup, Date.now() + 8000);

    const budget = await context.newPage();
    await budget.setViewportSize({ width: 400, height: 600 });
    await budget.goto(approvalUrl);
    await budget.getByTestId("auto-sign-budget-notice").waitFor({ timeout: 15000 });
    await budget
      .getByRole("button", { name: /Approve & sign/i })
      .waitFor({ state: "visible", timeout: 10000 });
    await screenshot(budget, "39-approval-over-budget", { delay: 900 });
    await rpc(popup, {
      type: "approval.resolve",
      requestId: (await rpc(popup, { type: "approval.getAll" })).requests[0].id,
      action: "deny",
    });
    await budget.close();
  });

  // Why a request was refused. A saved deny rule answers without a prompt, and
  // a site that queues more than five unanswered requests is refused for asking
  // too often. The person's own denial is already in the log from earlier. A
  // refusal because the key could not be read has no capture: it is only logged
  // when a key fails after the person approved, which the runner cannot cause.
  await step("38-activity-reasons", async () => {
    await rpc(popup, {
      type: "policy.setKindRule",
      origin: nostrich,
      kind: 30023,
      mode: "deny",
    });
    const refused = await signFromPage(nostrichPage, {
      kind: 30023,
      content: "A long-form post the saved rule refuses",
      tags: [["d", "post"]],
      created_at: Math.floor(Date.now() / 1000),
    });
    console.log("sign under a deny rule", JSON.stringify(refused));

    for (let i = 0; i < 7; i += 1) {
      await beginSignFromPage(snortPage, {
        kind: 1,
        content: `Unanswered note ${i + 1}`,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
    }
    await waitForPendingCount(popup, Date.now() + 8000);
    await popup.waitForTimeout(1000);
    const queued = await rpc(popup, { type: "approval.getAll" });
    for (const request of queued?.requests ?? []) {
      await rpc(popup, { type: "approval.resolve", requestId: request.id, action: "deny" });
    }

    await popup.reload();
    await safeClick(popup.getByRole("button", { name: /Activity/i }));
    await popup.getByText("Recent Activity").waitFor({ timeout: 10000 });
    await popup.getByText("Too many requests from this site").first().waitFor({ timeout: 10000 });
    await screenshot(popup, "38-popup-activity-reasons", { delay: 600 });

    // Three rows is all 600px shows, and the refusals with reasons sit below
    // the person's own denials. Same width, more height, so the whole run of
    // reasons is judged.
    await popup.setViewportSize({ width: 400, height: 1400 });
    await screenshot(popup, "38b-popup-activity-reasons-tall", { delay: 600 });
    await popup.setViewportSize({ width: 400, height: 600 });
  });

  await step("34-lock-screen-error", async () => {
    await popup.reload();
    await popup.getByRole("heading", { level: 2, name: KEY_NAME }).waitFor({ timeout: 15000 });
    await safeClick(popup.getByRole("button", { name: /Lock extension/i }));
    await popup.getByText(/Ostrilo is Locked/i).waitFor({ timeout: 10000 });
    await popup.locator('input[type="password"]').first().fill("not-the-password");
    await popup.keyboard.press("Enter");
    await popup.getByRole("alert").waitFor({ timeout: 10000 });
    await screenshot(popup, "34-lock-screen-error");
  });

  // The lock screen says why it locked. The vault is locked for real here; the
  // reason line is the only thing a page-level override of the background's
  // answer changes, so each reason's copy is judged in the real screen, at the
  // popup's width, in this theme. A background that does not answer at all is
  // its own screen.
  const lockReasons = [
    ["manual", undefined],
    ["inactivity", 35],
    ["background_restarted", undefined],
    ["state_unreadable", undefined],
    ["clock_rollback", undefined],
    ["browser_restarted", undefined],
    ["extension_updated", undefined],
  ];
  for (const [reason, minutes] of lockReasons) {
    await step(`36-lock-reason-${reason}`, async () => {
      const page = await context.newPage();
      await page.setViewportSize({ width: 400, height: 600 });
      await page.addInitScript(
        ({ lockReason, inactivityMinutes }) => {
          const runtime = globalThis.chrome.runtime;
          const original = runtime.sendMessage.bind(runtime);
          runtime.sendMessage = (...args) => {
            const answer = original(...args);
            if (args[0]?.type !== "state.getLock") return answer;
            return Promise.resolve(answer).then((response) =>
              response?.ok && response.data?.isLocked
                ? {
                    ...response,
                    data: { ...response.data, lockReason, inactivityMinutes },
                  }
                : response
            );
          };
        },
        { lockReason: reason, inactivityMinutes: minutes }
      );
      await page.goto(popupUrl);
      await page.getByTestId("lock-reason").waitFor({ timeout: 15000 });
      await screenshot(page, `36-lock-reason-${reason}`);
      await page.close();
    });
  }

  await step("36-lock-unreachable", async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 400, height: 600 });
    await page.addInitScript(() => {
      const runtime = globalThis.chrome.runtime;
      const original = runtime.sendMessage.bind(runtime);
      runtime.sendMessage = (...args) =>
        args[0]?.type === "state.getLock"
          ? Promise.reject(new Error("The message port closed before a response was received."))
          : original(...args);
    });
    await page.goto(popupUrl);
    await page.getByRole("heading", { name: "Can't reach Ostrilo" }).waitFor({ timeout: 15000 });
    await screenshot(page, "36-lock-unreachable");
    await page.close();
  });

  // A key whose stored record cannot be decrypted. The vault opens with the
  // others, selects nothing it cannot read and says which key is damaged. The
  // record is damaged the way bit rot does it: a flipped bit fails the AEAD tag.
  await step("37-unreadable-key", async () => {
    await popup.reload();
    await popup.locator('input[type="password"]').first().fill(CHANGED_PASSWORD);
    await popup.keyboard.press("Enter");
    await popup.getByRole("heading", { level: 2, name: KEY_NAME }).waitFor({ timeout: 20000 });

    const list = await rpc(popup, { type: "keys.list" });
    const work = list.find((k) => k.label === "Work");
    await rpc(popup, { type: "vault.select", id: work.id });
    await popup.evaluate(async (id) => {
      // aislop-ignore-next-line eslint/no-undef -- runs in the page's browser context via page.evaluate, not in Node; `chrome` is defined there.
      const { encryptedKeys } = await chrome.storage.local.get("encryptedKeys");
      const damaged = encryptedKeys.map((record) =>
        record.id === id ? { ...record, ct: record.ct.map((byte) => byte ^ 1) } : record
      );
      // aislop-ignore-next-line eslint/no-undef -- runs in the page's browser context via page.evaluate, not in Node; `chrome` is defined there.
      await chrome.storage.local.set({ encryptedKeys: damaged });
    }, work.id);
    await rpc(popup, { type: "vault.lock" });
    await popup.reload();
    await popup.locator('input[type="password"]').first().fill(CHANGED_PASSWORD);
    await popup.keyboard.press("Enter");
    await popup.getByText(/could not be read/i).first().waitFor({ timeout: 20000 });
    await screenshot(popup, "37-popup-home-unreadable-key");

    await safeClick(popup.getByRole("button", { name: /Profile/i }));
    await popup.getByText("Profile Settings").waitFor({ timeout: 10000 });
    await screenshot(popup, "37b-popup-profile-unreadable-key");

    await options.reload();
    await options.getByText("Ostrilo Settings").waitFor({ timeout: 15000 });
    await safeClick(options.getByRole("tab", { name: "Keys & Identities" }));
    await options.getByText(/could not be read/i).first().waitFor({ timeout: 10000 });
    await screenshot(options, "37c-options-keys-unreadable-key");
  });

  // Quick start is a first-run flow, so it needs a profile with no vault: a
  // second browser profile, the same build, this theme.
  await step("40-quick-start", async () => {
    const fresh = await launchContext(`${userDataDir}-quick-start`);
    try {
      const id = await waitForExtensionId(fresh);
      const page = await fresh.newPage();
      await page.setViewportSize({ width: 400, height: 600 });
      await page.goto(`chrome-extension://${id}/popup.html`);
      await page.getByText("Welcome to Ostrilo").waitFor({ timeout: 15000 });
      await safeClick(page.getByText("Quick start", { exact: true }));
      await page.getByRole("heading", { name: "Quick start" }).waitFor({ timeout: 10000 });
      await screenshot(page, "40-quick-start-password");
      await page.getByLabel("Master Password").fill(PASSWORD);
      await page.getByLabel("Confirm Password").fill(PASSWORD);
      await safeClick(page.getByRole("button", { name: "Create identity" }), 10000);
      await page.getByRole("heading", { name: "Your identity is ready" }).waitFor({ timeout: 20000 });
      await screenshot(page, "40b-quick-start-notice");
      await safeClick(page.getByRole("button", { name: "Continue" }));
      await page.getByText("This key has no backup").waitFor({ timeout: 20000 });
      await screenshot(page, "40c-quick-start-home");
    } finally {
      await fresh.close();
    }
  });
} finally {
  serverInfo.server.close();
  await context.close();
}

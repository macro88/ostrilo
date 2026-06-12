import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";

const cwd = process.cwd();
const extensionPath = path.join(cwd, ".output", "chrome-mv3");
const outDir = path.join(cwd, "docs", "design-review", "screenshots");
const userDataDir = path.join(
  "/private/tmp",
  `ostrilo-design-review-${Date.now()}`
);

await fs.mkdir(outDir, { recursive: true });

async function launchContext() {
  const base = {
    headless: true,
    viewport: { width: 400, height: 600 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...base,
      channel: "chromium",
    });
  } catch (error) {
    console.warn("Falling back to bundled Chromium:", error.message);
    return await chromium.launchPersistentContext(userDataDir, base);
  }
}

function startServer() {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>Ostrilo test dapp</title></head><body><h1>Ostrilo test dapp</h1><button id="sign" type="button">Sign</button></body></html>';
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
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

async function getPendingCount(page) {
  const countResult = await page.evaluate(() =>
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

  await safeClick(popup.getByRole("button", { name: /Create New Key/i }));
  await screenshot(popup, "02-onboarding-create-choice");
  await safeClick(popup.getByRole("button", { name: /Continue/i }));
  await popup.getByText("Create Your Nostr Key").waitFor({ timeout: 10000 });
  await screenshot(popup, "03-onboarding-create-key");

  await popup.locator("#keyName").fill("Design Review Key");
  await popup.locator("#password").fill("CorrectHorseBatteryStaple!2026");
  await popup.locator("#confirm-password").fill("CorrectHorseBatteryStaple!2026");
  await safeClick(popup.getByRole("button", { name: /Create Key/i }), 10000);
  await popup.getByText("Backup Your Key").waitFor({ timeout: 20000 });
  await screenshot(popup, "04-onboarding-backup");
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

  const origin = serverInfo.origin;
  const policyResult = await popup.evaluate((originValue) => {
    return chrome.runtime.sendMessage({
      type: "policy.setOrigin",
      origin: originValue,
      patch: { trustLevel: "low", rules: { 1: "ask" } },
    });
  }, origin);
  console.log("policy.setOrigin", JSON.stringify(policyResult));

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
    await approvalQueue.getByText("Pending Approvals").waitFor({
      timeout: 15000,
    });
    await screenshot(approvalQueue, "20-approval-queue");
    const firstRequest = approvalQueue
      .getByRole("button")
      .filter({ hasText: /Kind 1|Short Text Note|Design review/ })
      .last();
    if (await firstRequest.isVisible().catch(() => false)) {
      await firstRequest.click();
    } else {
      await approvalQueue.getByText(/Short Text Note|Kind 1/).click();
    }
    await approvalQueue.getByText("Signing request").waitFor({ timeout: 10000 });
    await screenshot(approvalQueue, "21-approval-detail");
  }

  await safeClick(popup.getByRole("button", { name: /Lock extension/i }));
  await popup.getByText(/Ostrilo is Locked/i).waitFor({ timeout: 10000 });
  await screenshot(popup, "22-lock-screen");
} finally {
  serverInfo.server.close();
  await context.close();
}

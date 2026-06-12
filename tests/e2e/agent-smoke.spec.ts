import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { captureStepScreenshot } from "./fixtures/screenshots";

const PASSWORD = "Ostrilo-Agent-Smoke-Password-2026!";
const DAPP_ORIGIN = "http://127.0.0.1:8765";
const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: RpcErrorObject };

type RpcErrorObject = {
  code: number;
  message: string;
  data?: {
    errorCode?: string;
    details?: string;
  };
};

function formatRpcError(error: RpcErrorObject): string {
  const code = error.data?.errorCode ?? error.message;
  const details = error.data?.details ? `: ${error.data.details}` : "";
  return `${code}${details}`;
}

async function sendExtensionRpc<T>(
  page: Page,
  message: Record<string, unknown>
): Promise<T> {
  const response = await page.evaluate(
    (rpcMessage) =>
      new Promise<RpcResponse<T>>((resolve, reject) => {
        const chromeApi = (globalThis as any).chrome;
        const runtime = chromeApi?.runtime;

        if (!runtime?.sendMessage) {
          reject(new Error("Extension runtime API is not available"));
          return;
        }

        runtime.sendMessage(rpcMessage, (value: RpcResponse<T>) => {
          const lastError = chromeApi.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(value);
        });
      }),
    message
  );

  if (!response.ok) {
    throw new Error(
      `RPC ${String(message.type)} failed: ${formatRpcError(response.error)}`
    );
  }

  return response.data;
}

async function completeCreateKeyOnboarding(
  page: Page,
  testInfo: Parameters<typeof captureStepScreenshot>[1]
) {
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.getByRole("heading", { name: "Welcome to Ostrilo" }))
    .toBeVisible();
  await captureStepScreenshot(page, testInfo, "01-popup-welcome");

  await page.getByText("Create New Key", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create Your Nostr Key" }))
    .toBeVisible();
  await page.getByLabel("Key Name").fill("Agent Smoke Key");
  await page.getByLabel("Master Password").fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await expect(page.getByText(/Good|Strong/)).toBeVisible();
  await captureStepScreenshot(page, testInfo, "02-create-key-form");

  await page.getByRole("button", { name: /Create Key/i }).click();
  await expect(page.getByRole("heading", { name: "Backup Your Key" }))
    .toBeVisible({ timeout: 15_000 });
  await captureStepScreenshot(page, testInfo, "03-backup-key");

  await page.getByRole("button", { name: "Reveal Private Key" }).click();
  const privateKeyInput = page.getByLabel("Private Key (nsec format)");
  await expect(privateKeyInput).toBeVisible();
  await expect(privateKeyInput).toHaveValue(/^nsec1/);
  await captureStepScreenshot(page, testInfo, "04-backup-key-revealed-masked");

  await page
    .getByLabel(/I have safely backed up my private key/)
    .check();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Agent Smoke Key" }))
    .toBeVisible({ timeout: 15_000 });
  await captureStepScreenshot(page, testInfo, "05-popup-home");
}

test.describe("Agent extension smoke", () => {
  test("creates a key, signs through NIP-07, and captures review screenshots", async ({
    openPopup,
    extensionContext,
  }, testInfo) => {
    const popup = await openPopup();

    await completeCreateKeyOnboarding(popup, testInfo);

    await popup.getByRole("button", { name: "Activity" }).click();
    await expect(popup.getByRole("heading", { name: "Recent Activity" }))
      .toBeVisible();
    await expect(popup.getByText("No activity yet")).toBeVisible();
    await captureStepScreenshot(popup, testInfo, "06-activity-empty-state");

    await popup.getByRole("button", { name: "Settings" }).click();
    await expect(popup.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(popup.getByText("Active Key")).toBeVisible();
    await captureStepScreenshot(popup, testInfo, "07-settings-active-key");

    await sendExtensionRpc(popup, {
      type: "policy.setKindRule",
      origin: DAPP_ORIGIN,
      kind: 1,
      mode: "allow",
    });

    const dapp = await extensionContext.newPage();
    await dapp.setViewportSize({ width: 900, height: 700 });
    await dapp.goto(DAPP_URL);
    await expect(dapp.locator("#status")).toHaveText("window.nostr available");
    await captureStepScreenshot(dapp, testInfo, "08-dapp-nostr-injected");

    const pubkey = await dapp.evaluate(() => window.testGetPublicKey());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    await expect(dapp.locator("#pubkey")).toHaveText(pubkey);

    const signedEvent = await dapp.evaluate(() =>
      window.testSignEvent({
        kind: 1,
        content: "Signed by Ostrilo Playwright smoke test",
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      })
    );

    expect(signedEvent.pubkey).toBe(pubkey);
    expect(signedEvent.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signedEvent.sig).toMatch(/^[0-9a-f]{128}$/);
    await expect(dapp.locator("#signed-event")).toContainText(
      "Signed by Ostrilo Playwright smoke test"
    );
    await captureStepScreenshot(dapp, testInfo, "09-dapp-signed-event");

    await popup.getByRole("button", { name: "Activity" }).click();
    await expect(popup.getByText("Short Text Note")).toBeVisible({
      timeout: 10_000,
    });
    await expect(popup.getByText("127.0.0.1")).toBeVisible();
    await captureStepScreenshot(popup, testInfo, "10-activity-signed-event");
  });
});

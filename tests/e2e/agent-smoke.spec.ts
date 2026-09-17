import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";
import { captureStepScreenshot } from "./fixtures/screenshots";

const PASSWORD = "Marigold-Trellis-Pebble-2026!";
const DAPP_ORIGIN = "https://localhost:8765";
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
  // Masked means masked: the nsec is not in the DOM until it is asked for.
  await expect(privateKeyInput).not.toHaveValue(/^nsec1/);
  await captureStepScreenshot(page, testInfo, "04-backup-key-revealed-masked");

  await page.getByRole("button", { name: "Show private key" }).click();
  await expect(privateKeyInput).toHaveValue(/^nsec1/);
  const nsec = await privateKeyInput.inputValue();
  await captureStepScreenshot(page, testInfo, "05-backup-key-revealed");

  // The acknowledgement is a statement of understanding; verification is the
  // gate. Both are exercised here because both are on the screenshot path.
  await page
    .getByRole("checkbox", { name: "Confirm private key backup" })
    .check();
  await page
    .getByLabel("Last 8 characters of your nsec")
    .fill(nsec.slice(-8));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Backup verified")).toBeVisible();
  await captureStepScreenshot(page, testInfo, "06-backup-verified");

  await page.getByRole("button", { name: "Finish" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Agent Smoke Key" }))
    .toBeVisible({ timeout: 15_000 });
  await captureStepScreenshot(page, testInfo, "07-popup-home");
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
    await captureStepScreenshot(popup, testInfo, "08-activity-empty-state");

    await popup.getByRole("button", { name: "Settings" }).click();
    await expect(popup.getByRole("heading", { name: "Settings" })).toBeVisible();
    // The quick-controls panel carries the controls, not a copy of the active
    // key: the header names that on every tab. A control and the panel's one
    // action stand in for "this rendered".
    await expect(popup.getByLabel("Theme")).toBeVisible();
    await expect(popup.getByRole("button", { name: "Lock now" })).toBeVisible();
    await captureStepScreenshot(popup, testInfo, "09-settings-quick-controls");

    // `allow` is a standing permission to sign without prompting, so it is
    // password-gated in the background. The password rides with the request;
    // a caller that omits it is refused, which is the point of the gate.
    await sendExtensionRpc(popup, {
      type: "policy.setKindRule",
      origin: DAPP_ORIGIN,
      kind: 7,
      mode: "allow",
      password: PASSWORD,
    });

    // Identity disclosure is consented in setup. Without this the
    // `testGetPublicKey()` below does not FAIL - it queues an approval prompt
    // and blocks for APPROVAL_TIMEOUT_MS (60s), which reads as flakiness
    // rather than as a missing grant.
    await sendExtensionRpc(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { identityDisclosure: "allow" },
    });

    const dapp = await extensionContext.newPage();
    await dapp.setViewportSize({ width: 900, height: 700 });
    await dapp.goto(DAPP_URL);
    await expect(dapp.locator("#status")).toHaveText("window.nostr available");
    await captureStepScreenshot(dapp, testInfo, "10-dapp-nostr-injected");

    const pubkey = await dapp.evaluate(() => window.testGetPublicKey());
    expect(pubkey).toMatch(/^[0-9a-f]{64}$/);
    await expect(dapp.locator("#pubkey")).toHaveText(pubkey);

    const signedEvent = await dapp.evaluate(() =>
      window.testSignEvent({
        kind: 7,
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
    await captureStepScreenshot(dapp, testInfo, "11-dapp-signed-event");

    await popup.getByRole("button", { name: "Activity" }).click();
    await expect(popup.getByText("Reaction")).toBeVisible({
      timeout: 10_000,
    });
    await expect(popup.getByText("localhost:8765").first()).toBeVisible();
    await captureStepScreenshot(popup, testInfo, "12-activity-signed-event");
  });
});

import { test, expect } from "./fixtures/extension";
import type { Page } from "./fixtures/extension";

const PASSWORD = "Harbour-Kestrel-Mantle-2026!";
const DAPP_ORIGIN = "http://127.0.0.1:8765";
const DAPP_URL = `${DAPP_ORIGIN}/test-page.html`;

type RpcResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; data?: { errorCode?: string } } };

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
    const code = response.error.data?.errorCode ?? response.error.message;
    throw new Error(`RPC ${String(message.type)} failed: ${code}`);
  }

  return response.data;
}

async function completeCreateKeyOnboarding(page: Page) {
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.getByRole("heading", { name: "Welcome to Ostrilo" }))
    .toBeVisible();

  await page.getByText("Create New Key", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create Your Nostr Key" }))
    .toBeVisible();
  await page.getByLabel("Key Name").fill("Protected Kind Test Key");
  await page.getByLabel("Master Password").fill(PASSWORD);
  await page.getByLabel("Confirm Password").fill(PASSWORD);
  await expect(page.getByText(/Good|Strong/)).toBeVisible();

  await page.getByRole("button", { name: /Create Key/i }).click();
  await expect(page.getByRole("heading", { name: "Backup Your Key" }))
    .toBeVisible({ timeout: 15_000 });
  // Finish is gated on backup verification, not on the acknowledgement
  // checkbox. Reveal, read the key, and re-enter its last 8 characters.
  await page.getByRole("button", { name: "Reveal Private Key" }).click();
  await page.getByRole("button", { name: "Show private key" }).click();
  const nsec = await page.getByLabel("Private Key (nsec format)").inputValue();
  await page
    .getByRole("checkbox", { name: "Confirm private key backup" })
    .check();
  await page.getByLabel("Last 8 characters of your nsec").fill(nsec.slice(-8));
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText("Backup verified")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Protected Kind Test Key" })
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Protected kind policy", () => {
  test("high trust still requires approval for kind 1 before signing", async ({
    openPopup,
    extensionContext,
  }) => {
    const popup = await openPopup();
    await completeCreateKeyOnboarding(popup);

    await sendExtensionRpc(popup, {
      type: "policy.setOrigin",
      origin: DAPP_ORIGIN,
      patch: { trustLevel: "high" },
    });
    await sendExtensionRpc(popup, {
      type: "policy.setKindRule",
      origin: DAPP_ORIGIN,
      kind: 1,
      mode: "allow",
    });

    const dapp = await extensionContext.newPage();
    await dapp.goto(DAPP_URL);
    await expect(dapp.locator("#status")).toHaveText("window.nostr available");

    const signResultPromise = dapp.evaluate(async () => {
      try {
        const signed = await window.testSignEvent({
          kind: 1,
          content: "Protected kind should wait for approval",
          tags: [],
          created_at: Math.floor(Date.now() / 1000),
        });

        return { success: true, signed };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    await expect
      .poll(async () => {
        const data = await sendExtensionRpc<{
          requests: Array<{ id: string; event: { kind: number } }>;
        }>(popup, { type: "approval.getAll" });
        return data.requests.length;
      })
      .toBe(1);

    const data = await sendExtensionRpc<{
      requests: Array<{ id: string; event: { kind: number } }>;
    }>(popup, { type: "approval.getAll" });
    expect(data.requests[0].event.kind).toBe(1);
    await expect(dapp.locator("#signed-event")).toHaveText("");

    await sendExtensionRpc(popup, {
      type: "approval.resolve",
      requestId: data.requests[0].id,
      action: "allow_once",
    });

    const signResult = await signResultPromise;
    expect(signResult.success).toBe(true);
    expect(signResult).toHaveProperty("signed");
    const signed = (signResult as {
      success: true;
      signed: { kind: number; sig: string };
    }).signed;
    expect(signed.kind).toBe(1);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
  });
});
